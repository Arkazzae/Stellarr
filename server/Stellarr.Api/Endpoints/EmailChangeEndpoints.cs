using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

public sealed record EmailChangeStartRequest(string? Email, string? Password);

public sealed record EmailChangeConfirmRequest(string? Token);

/// <summary>
/// Changing the account's address. The address receives the sign-in codes,
/// the security alerts and the password reset links, so a change asks for the
/// current password and, once the account has one, a fresh second step; and
/// the new address must prove it receives mail before it replaces the old
/// one, which is told afterwards.
/// </summary>
public static partial class EmailChangeEndpoints
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromHours(1);

    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Sending the address confirmation for request {RequestId} failed.")]
    private static partial void ConfirmationMailFailed(ILogger logger, Guid requestId, Exception exception);

    public static IEndpointRouteBuilder MapEmailChangeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/me/email", StartAsync)
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.AuthWrite);
        // The link may be opened on another device; the token alone proves the
        // new address, and the page asks for a click before it is spent.
        endpoints.MapPost("/api/auth/email/confirm", ConfirmAsync)
            .RequireRateLimiting(RateLimitPolicies.AuthWrite);
        return endpoints;
    }

    private static async Task<IResult> StartAsync(
        EmailChangeStartRequest request,
        HttpContext context,
        AppDbContext db,
        PasswordService passwords,
        IEmailDelivery delivery,
        IOptions<MailOptions> mailOptions,
        InstanceSecrets secrets,
        IConfiguration configuration,
        Messages messages,
        ILoggerFactory loggers,
        CancellationToken cancellationToken)
    {
        var email = request.Email?.Trim() ?? "";
        if (email.Length > 320 ||
            !MailAddress.TryCreate(email, out var address) ||
            !string.Equals(address.Address, email, StringComparison.OrdinalIgnoreCase))
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["email"] = [messages.Get(MessageKey.EmailInvalid)] });
        }

        var userId = context.User.RequireUserId();
        var user = await db.Users.SingleAsync(x => x.Id == userId, cancellationToken);
        // Checked before the password, so a stolen session cannot use this form
        // to try passwords on an account that has a second step.
        if (!await MfaPolicy.HasFreshSecondStepAsync(db, user.Id, context.User.FindSessionId(), cancellationToken))
        {
            return Outcome("second-step-required");
        }

        if (request.Password is null || !passwords.Verify(request.Password, user.PasswordHash))
        {
            return Outcome("wrong-password");
        }

        var normalized = email.ToUpperInvariant();
        if (normalized == user.NormalizedEmail)
        {
            return Outcome("same");
        }

        if (await db.Users.AnyAsync(x => x.NormalizedEmail == normalized && x.Id != user.Id, cancellationToken))
        {
            return Outcome("taken");
        }

        if (await AccountMail.FindAsync(db, configuration, mailOptions.Value, secrets, cancellationToken) is not { } mailing)
        {
            return Outcome("mail-unavailable");
        }

        var now = DateTime.UtcNow;
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var change = new EmailChangeRequest
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            NewEmail = email,
            NormalizedNewEmail = normalized,
            TokenHash = Hash(token),
            CreatedAt = now,
            ExpiresAt = now + LinkLifetime,
        };
        // Only the latest request counts.
        await db.EmailChangeRequests
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        db.EmailChangeRequests.Add(change);
        await db.SaveChangesAsync(cancellationToken);

        var link = $"{mailing.PublicUrl}/confirm-email?token={Uri.EscapeDataString(token)}";
        try
        {
            await delivery.SendAsync(
                AccountEmail.EmailChange(mailing.Sender, email, user.DisplayName, mailing.InstanceName, link, change.Id, messages),
                mailing.Transport,
                cancellationToken);
        }
        catch (Exception exception) when (
            exception is MailDeliveryException or HttpRequestException or InvalidOperationException ||
            (exception is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            ConfirmationMailFailed(loggers.CreateLogger("Stellarr.Api.Mail"), change.Id, exception);
            return Outcome("mail-unavailable");
        }

        return Outcome("sent");
    }

    private static async Task<IResult> ConfirmAsync(
        EmailChangeConfirmRequest request,
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var token = request.Token?.Trim() ?? "";
        if (token.Length is 0 or > 256)
        {
            return Outcome("invalid");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        var now = DateTime.UtcNow;
        var hash = Hash(token);
        var change = await db.EmailChangeRequests.Include(x => x.User)
            .SingleOrDefaultAsync(x => x.TokenHash == hash, cancellationToken);
        if (change is null || change.UsedAt is not null || change.ExpiresAt <= now || change.User.IsDisabled)
        {
            return Outcome("invalid");
        }

        var user = change.User;
        if (await db.Users.AnyAsync(x => x.NormalizedEmail == change.NormalizedNewEmail && x.Id != user.Id, cancellationToken))
        {
            return Outcome("taken");
        }

        // The alert goes to the address being replaced, before it is.
        var previousAddress = await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken);
        var previous = user.NormalizedEmail;
        user.Email = change.NewEmail;
        user.NormalizedEmail = change.NormalizedNewEmail;
        change.UsedAt = now;

        // Codes and reset links sent to the old address stop working with it.
        var oldEmailMethods = await db.MfaMethods
            .Where(x => x.UserId == user.Id &&
                x.Type == MfaMethodTypes.Email &&
                x.RevokedAt == null &&
                x.EmailAddress != change.NormalizedNewEmail)
            .ToListAsync(cancellationToken);
        foreach (var method in oldEmailMethods)
        {
            method.RevokedAt = now;
            SecurityEvents.Record(db, user.Id, SecurityEventKinds.MethodRemoved, context, "email changed");
        }

        await db.EmailOtpCodes
            .Where(x => x.UserId == user.Id && x.ConsumedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ConsumedAt, now), cancellationToken);
        await db.PasswordResetTokens
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        await db.EmailChangeRequests
            .Where(x => x.UserId == user.Id && x.UsedAt == null && x.Id != change.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.EmailChanged, context,
            previous is null ? "address added" : "address changed",
            previousAddress);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (DatabaseErrors.IsUniqueConstraint(exception))
        {
            return Outcome("taken");
        }

        await transaction.CommitAsync(cancellationToken);
        return Outcome("changed");
    }

    private static IResult Outcome(string result) => Results.Ok(new { result });

    private static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
