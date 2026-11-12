using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Auth.Security;

public static class SecurityEvents
{
    private static readonly HashSet<string> NotifiedKinds =
    [
        SecurityEventKinds.LoginSucceeded,
        SecurityEventKinds.MfaSucceeded,
        SecurityEventKinds.MethodAdded,
        SecurityEventKinds.MethodRemoved,
        SecurityEventKinds.RecoveryCodeUsed,
        SecurityEventKinds.TrustedDeviceAdded,
        SecurityEventKinds.TrustedDeviceRemoved,
        SecurityEventKinds.SessionRevoked,
        SecurityEventKinds.PasswordChanged,
        SecurityEventKinds.CliRecovery,
        SecurityEventKinds.PolicyChanged,
        SecurityEventKinds.DesktopApproved,
        SecurityEventKinds.IdentityLinked,
        SecurityEventKinds.IdentityUnlinked,
        SecurityEventKinds.EmailChanged,
    ];

    /// <summary>
    /// Records an account-global fact. The caller saves the event with its own
    /// transaction; the alert, when there is a verified address, is a separate
    /// durable row and can never roll that transaction back.
    /// </summary>
    public static void Record(
        AppDbContext db,
        Guid userId,
        string kind,
        HttpContext? context,
        string detail,
        string? verifiedEmail = null)
    {
        var now = DateTime.UtcNow;
        var securityEvent = new SecurityEvent
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = kind,
            Detail = Truncate(detail, 500),
            IpAddress = Truncate(context?.Connection.RemoteIpAddress?.ToString() ?? "", 64),
            Device = Truncate(context?.Request.Headers.UserAgent.ToString().Trim() ?? "", 300),
            CreatedAt = now,
        };
        db.SecurityEvents.Add(securityEvent);
        if (verifiedEmail is not { Length: > 0 } email || !NotifiedKinds.Contains(kind))
        {
            return;
        }

        db.SecurityNotifications.Add(new SecurityNotification
        {
            Id = Guid.NewGuid(),
            SecurityEventId = securityEvent.Id,
            UserId = userId,
            EmailAddress = email,
            CreatedAt = now,
            NextAttemptAt = now,
        });
    }

    /// <summary>Failed second-factor proofs across all challenges, for the account-wide throttle.</summary>
    public static Task<int> RecentMfaFailuresAsync(
        AppDbContext db,
        Guid userId,
        DateTime since,
        CancellationToken cancellationToken) =>
        db.SecurityEvents.CountAsync(
            x => x.UserId == userId && x.Kind == SecurityEventKinds.MfaFailed && x.CreatedAt >= since,
            cancellationToken);

    public static async Task<string?> VerifiedEmailAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken)    {
        var user = await db.Users.AsNoTracking()
            .Where(x => x.Id == userId)
            .Select(x => new { x.NormalizedEmail, x.Email })
            .SingleOrDefaultAsync(cancellationToken);
        if (user?.NormalizedEmail is not { Length: > 0 } normalized ||
            user.Email?.Trim() is not { Length: > 0 } recipient)
        {
            return null;
        }

        var verified = await db.MfaMethods.AsNoTracking()
            .AnyAsync(
                x => x.UserId == userId &&
                    x.Type == MfaMethodTypes.Email &&
                    x.ConfirmedAt != null &&
                    x.RevokedAt == null &&
                    x.EmailAddress == normalized,
                cancellationToken);
        return verified ? recipient : null;
    }

    public static string Describe(string kind, string detail) => detail.Length == 0 ? kind : $"{kind}: {detail}";

    private static string Truncate(string value, int maximum) =>
        value.Length <= maximum ? value : value[..maximum];
}

public sealed class SecurityNotificationDispatcher(
    AppDbContext db,
    IConfiguration configuration,
    IOptions<MailOptions> mailOptions,
    InstanceSecrets secrets,
    IEmailDelivery delivery,
    Messages messages,
    ILogger<SecurityNotificationDispatcher> logger)
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMinutes(5);

    private static readonly Action<ILogger, Guid, Exception?> NotificationFailed = LoggerMessage.Define<Guid>(
        LogLevel.Warning,
        new EventId(1, "SecurityNotificationFailed"),
        "A security notification for account {UserId} could not be sent.");

    /// <summary>Attempts a bounded batch. A missing mail setup leaves the row for later.</summary>
    public async Task<int> DispatchAsync(DateTime utcNow, CancellationToken cancellationToken)
    {
        var pending = await db.SecurityNotifications
            .Include(x => x.SecurityEvent)
            .Include(x => x.User)
            .Where(x => x.SentAt == null && x.NextAttemptAt <= utcNow && x.Attempts < 20)
            .OrderBy(x => x.NextAttemptAt)
            .Take(25)
            .ToArrayAsync(cancellationToken);
        if (pending.Length == 0)
        {
            return 0;
        }

        var instanceServerId = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        var settings = instanceServerId is null
            ? null
            : await db.OperationsSettings.AsNoTracking()
                .SingleOrDefaultAsync(x => x.ServerId == instanceServerId, cancellationToken);
        if (settings is not { AlertMailEnabled: true })
        {
            foreach (var item in pending)
            {
                item.NextAttemptAt = utcNow.AddHours(1);
            }

            await db.SaveChangesAsync(cancellationToken);
            return 0;
        }

        var mailing = await AccountMail.FindAsync(db, configuration, mailOptions.Value, secrets, cancellationToken);
        if (mailing is null)
        {
            foreach (var item in pending)
            {
                item.NextAttemptAt = utcNow.AddHours(1);
            }

            await db.SaveChangesAsync(cancellationToken);
            return 0;
        }

        var sent = 0;
        foreach (var item in pending)
        {
            item.Attempts++;
            item.LastAttemptAt = utcNow;
            try
            {
                await delivery.SendAsync(
                    AccountEmail.SecurityAlert(
                        mailing.Sender,
                        item.EmailAddress,
                        item.User.DisplayName,
                        mailing.InstanceName,
                        SecurityEvents.Describe(item.SecurityEvent.Kind, item.SecurityEvent.Detail),
                        item.SecurityEvent.CreatedAt,
                        item.SecurityEventId,
                        messages),
                    mailing.Transport,
                    cancellationToken);
                item.SentAt = utcNow;
                item.LastError = "";
                sent++;
            }
            catch (Exception exception) when (exception is MailDeliveryException or HttpRequestException or InvalidOperationException)
            {
                item.LastError = exception.Message.Length > 500 ? exception.Message[..500] : exception.Message;
                item.NextAttemptAt = utcNow + TimeSpan.FromMinutes(Math.Min(RetryDelay.TotalMinutes * item.Attempts, 60));
                NotificationFailed(logger, item.UserId, null);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return sent;
    }
}

public sealed class SecurityNotificationWorker(
    IServiceProvider services,
    ILogger<SecurityNotificationWorker> logger) : BackgroundService
{
    private static readonly Action<ILogger, Exception?> QueueFailed = LoggerMessage.Define(
        LogLevel.Warning,
        new EventId(1, "SecurityNotificationQueueFailed"),
        "The security notification queue could not be processed.");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = services.CreateAsyncScope();
                var dispatcher = scope.ServiceProvider.GetRequiredService<SecurityNotificationDispatcher>();
                await dispatcher.DispatchAsync(DateTime.UtcNow, stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                QueueFailed(logger, exception);
            }

            try
            {
                await timer.WaitForNextTickAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
