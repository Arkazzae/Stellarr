using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Lets somebody who forgot their password set a new one through a link that
/// is mailed to the address of the account.
/// </summary>
public static partial class PasswordRecoveryEndpoints
{
    private const string InvalidLinkMessage = "Link do zmiany hasła jest nieprawidłowy lub wygasł.";

    private static readonly TimeSpan LinkLifetime = TimeSpan.FromHours(1);

    /// <summary>Where the mail goes out from and what its link points at.</summary>
    private sealed record Mailing(string Sender, string PublicUrl);

    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Nie udało się wysłać wiadomości resetu hasła dla tokenu {TokenId}")]
    private static partial void PasswordResetMailFailed(ILogger logger, Guid tokenId, Exception exception);

    public static IEndpointRouteBuilder MapPasswordRecoveryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var recovery = endpoints.MapGroup("/api/auth/password");
        recovery.MapPost("/forgot", ForgotPasswordAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        recovery.MapPost("/reset", ResetPasswordAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        return endpoints;
    }

    private static async Task<IResult> ForgotPasswordAsync(
        ForgotPasswordRequest request,
        AppDbContext db,
        IEmailDelivery delivery,
        IOptions<MailOptions> mailOptions,
        IConfiguration configuration,
        ILoggerFactory loggers,
        CancellationToken cancellationToken)
    {
        // Every answer is the same 202, whether or not the address belongs to an
        // account and whether or not a mail could go out, and comes as slowly.
        await Task.Delay(Random.Shared.Next(80, 180), cancellationToken);
        var normalizedEmail = (request.Email?.Trim() ?? "").ToUpperInvariant();
        var user = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedEmail == normalizedEmail && !x.IsDisabled,
            cancellationToken);
        if (user is null)
        {
            return Results.Accepted();
        }

        var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync(cancellationToken);
        if (await FindMailingAsync(db, server, mailOptions.Value, configuration, cancellationToken) is not { } mailing)
        {
            return Results.Accepted();
        }

        var now = DateTime.UtcNow;
        var earlierLinks = await db.PasswordResetTokens
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ToArrayAsync(cancellationToken);
        var rawToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var token = new PasswordResetToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = HashToken(rawToken),
            CreatedAt = now,
            ExpiresAt = now + LinkLifetime,
        };
        db.PasswordResetTokens.Add(token);
        await db.SaveChangesAsync(cancellationToken);

        var link = $"{mailing.PublicUrl}/reset-hasla?token={Uri.EscapeDataString(rawToken)}";
        try
        {
            await delivery.SendAsync(
                AccountEmail.PasswordReset(mailing.Sender, user.Email!, user.DisplayName, server.Name, link, token.Id),
                cancellationToken);
        }
        catch (Exception exception) when (IsDeliveryFailure(exception, cancellationToken))
        {
            // The new link stays valid: a provider that timed out may well have sent it.
            PasswordResetMailFailed(loggers.CreateLogger("Stellarr.Api.Mail"), token.Id, exception);
            return Results.Accepted();
        }

        // The older links go only once a new one is out, so that an unreachable
        // provider does not take away the last link the person was sent.
        foreach (var earlier in earlierLinks)
        {
            earlier.UsedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Accepted();
    }

    private static async Task<IResult> ResetPasswordAsync(
        ResetPasswordRequest request,
        AppDbContext db,
        PasswordService passwords,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (PasswordPolicy.Violation(request.NewPassword) is { } passwordProblem)
        {
            errors["newPassword"] = [passwordProblem];
        }

        if (string.IsNullOrWhiteSpace(request.Token))
        {
            errors["token"] = [InvalidLinkMessage];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var hash = HashToken(request.Token);
        var now = DateTime.UtcNow;
        var token = await db.PasswordResetTokens.Include(x => x.User)
            .SingleOrDefaultAsync(x => x.TokenHash == hash, cancellationToken);
        if (token is null || token.UsedAt is not null || token.ExpiresAt <= now || token.User.IsDisabled)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: InvalidLinkMessage);
        }

        token.User.PasswordHash = passwords.Hash(request.NewPassword);
        // Every cookie issued before this point stops working.
        token.User.SessionVersion++;
        var unusedLinks = await db.PasswordResetTokens
            .Where(x => x.UserId == token.UserId && x.UsedAt == null)
            .ToArrayAsync(cancellationToken);
        foreach (var link in unusedLinks)
        {
            link.UsedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>The settings to send with, or null when the instance is not set up to send recovery mail.</summary>
    private static async Task<Mailing?> FindMailingAsync(
        AppDbContext db,
        StellarrServer server,
        MailOptions options,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var settings = await db.OperationsSettings.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ServerId == server.Id, cancellationToken);
        var mailingEnabled = settings?.MailingEnabled ?? configuration.GetValue<bool>("Mail:Enabled");
        var recoveryEnabled = settings?.RecoveryMailEnabled ?? true;
        var fromAddress = FirstNotBlank(settings?.MailFromAddress, options.FromAddress);
        var publicUrl = FirstNotBlank(settings?.PublicUrl, configuration["Operations:PublicUrl"]).TrimEnd('/');
        if (!mailingEnabled || !recoveryEnabled ||
            fromAddress.Length == 0 || publicUrl.Length == 0 || string.IsNullOrWhiteSpace(options.ResendApiKey))
        {
            return null;
        }

        var sender = string.IsNullOrWhiteSpace(options.FromName) ? fromAddress : $"{options.FromName.Trim()} <{fromAddress}>";
        return new Mailing(sender, publicUrl);
    }

    /// <summary>
    /// Whether the exception means the provider could not take the message.
    /// HttpClient reports its own timeout as a cancellation; that is not the
    /// caller giving up on the request and must not turn a known address into
    /// an answer that differs from an unknown one.
    /// </summary>
    private static bool IsDeliveryFailure(Exception exception, CancellationToken requestAborted) =>
        exception is HttpRequestException or InvalidOperationException ||
        (exception is OperationCanceledException && !requestAborted.IsCancellationRequested);

    private static string FirstNotBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? "";

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
