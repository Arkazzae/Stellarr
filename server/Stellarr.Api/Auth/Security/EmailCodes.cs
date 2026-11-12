using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Auth.Security;

public enum EmailCodeSendResult
{
    Sent,
    Unavailable,
    Cooldown,
    Limit,
    DeliveryFailed,
}

public sealed record EmailCodeSendOutcome(EmailCodeSendResult Result, int RetryAfterSeconds = 0);

public sealed record EmailCodeProof(Guid CodeId);

public static class EmailCodes
{
    private static readonly Action<ILogger, Guid, Exception?> DeliveryFailed = LoggerMessage.Define<Guid>(
        LogLevel.Warning,
        new EventId(1, "EmailCodeDeliveryFailed"),
        "An e-mail code for account {UserId} could not be sent.");

    public static async Task<EmailCodeSendOutcome> SendAsync(
        AppDbContext db,
        IConfiguration configuration,
        MailOptions options,
        InstanceSecrets secrets,
        IEmailDelivery delivery,
        IDataProtectionProvider protection,
        Messages messages,
        ILogger logger,
        User user,
        string purpose,
        Guid? methodId,
        Guid challengeId,
        string expectedEmailAddress,
        SecurityPolicy policy,
        CancellationToken cancellationToken)
    {
        var recipient = user.Email?.Trim();
        if (user.NormalizedEmail is not { Length: > 0 } normalized ||
            recipient is not { Length: > 0 } ||
            !string.Equals(Normalize(expectedEmailAddress).ToUpperInvariant(), normalized, StringComparison.Ordinal))
        {
            return new EmailCodeSendOutcome(EmailCodeSendResult.Unavailable);
        }

        // The transport check reads settings; it must happen before the short
        // write transaction, which is never held across the network call.
        var mailing = await AccountMail.FindAsync(db, configuration, options, secrets, cancellationToken);
        if (mailing is null)
        {
            return new EmailCodeSendOutcome(EmailCodeSendResult.Unavailable);
        }

        EmailOtpCode emailCode;
        await using (var transaction = await db.Database.BeginTransactionAsync(
                         System.Data.IsolationLevel.Serializable, cancellationToken))
        {
            // Serialize the per-account cooldown and hourly budget with other
            // sends, then reserve the row before any delivery attempt.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {user.Id};",
                cancellationToken);
            var now = DateTime.UtcNow;
            var latest = await db.EmailOtpCodes.AsNoTracking()
                .Where(x => x.UserId == user.Id && x.Purpose == purpose)
                .OrderByDescending(x => x.CreatedAt)
                .Select(x => (DateTime?)x.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken);
            if (latest is { } sentAt)
            {
                var cooldown = sentAt + policy.EmailCooldown - now;
                if (cooldown > TimeSpan.Zero)
                {
                    return new EmailCodeSendOutcome(
                        EmailCodeSendResult.Cooldown, (int)Math.Ceiling(cooldown.TotalSeconds));
                }
            }

            var sentLastHour = await db.EmailOtpCodes.AsNoTracking().CountAsync(
                x => x.UserId == user.Id && x.Purpose == purpose && x.CreatedAt > now.AddHours(-1),
                cancellationToken);
            if (sentLastHour >= Math.Clamp(policy.EmailCodeSendsPerHour, 1, 60))
            {
                return new EmailCodeSendOutcome(EmailCodeSendResult.Limit);
            }

            var code = SecurityTokens.RandomDigits(6);
            emailCode = new EmailOtpCode
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                MethodId = methodId,
                ChallengeId = challengeId,
                Purpose = purpose,
                EmailAddress = recipient,
                ProtectedCode = SecurityProtection.ProtectEmailCode(protection, user.Id, purpose, code),
                MaxAttempts = Math.Clamp(policy.EmailCodeMaxAttempts, 1, 10),
                CreatedAt = now,
                ExpiresAt = now + policy.EmailCodeLifetime,
            };
            db.EmailOtpCodes.Add(emailCode);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            try
            {
                await delivery.SendAsync(
                    AccountEmail.EmailCode(
                        mailing.Sender,
                        recipient,
                        user.DisplayName,
                        mailing.InstanceName,
                        code,
                        emailCode.Id,
                        messages),
                    mailing.Transport,
                    cancellationToken);
            }
            catch (Exception exception) when (exception is MailDeliveryException or HttpRequestException or InvalidOperationException)
            {
                DeliveryFailed(logger, user.Id, null);
                // The reservation remains part of the durable cooldown and
                // hourly budget even though delivery failed.
                emailCode.ConsumedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(cancellationToken);
                return new EmailCodeSendOutcome(EmailCodeSendResult.DeliveryFailed);
            }

            emailCode.DeliveredAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return new EmailCodeSendOutcome(EmailCodeSendResult.Sent);
        }
    }

    public static async Task<EmailCodeProof?> CheckAsync(
        AppDbContext db,
        IDataProtectionProvider protection,
        Guid userId,
        Guid challengeId,
        string purpose,
        Guid? methodId,
        string emailAddress,
        string supplied,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var code = await db.EmailOtpCodes
            .Where(x => x.UserId == userId &&
                x.ChallengeId == challengeId &&
                x.Purpose == purpose &&
                x.MethodId == methodId &&
                x.EmailAddress == emailAddress &&
                x.ConsumedAt == null &&
                x.DeliveredAt != null)
            .OrderByDescending(x => x.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (code is null || code.ExpiresAt <= now || code.Attempts >= code.MaxAttempts)
        {
            return null;
        }

        if (!SecurityProtection.EmailCodeMatches(protection, userId, purpose, code.ProtectedCode, supplied.Trim()))
        {
            await db.EmailOtpCodes
                .Where(x => x.Id == code.Id && x.ConsumedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(x => x.Attempts, x => x.Attempts + 1)
                        .SetProperty(x => x.ConsumedAt, x => x.Attempts + 1 >= x.MaxAttempts ? now : x.ConsumedAt),
                    cancellationToken);
            return null;
        }

        return new EmailCodeProof(code.Id);
    }

    public static async Task<bool> ConsumeAsync(
        AppDbContext db,
        EmailCodeProof proof,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var changed = await db.EmailOtpCodes
            .Where(x => x.Id == proof.CodeId && x.ConsumedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ConsumedAt, now), cancellationToken);
        return changed == 1;
    }

    public static async Task<bool> VerifyAsync(
        AppDbContext db,
        IDataProtectionProvider protection,
        Guid userId,
        Guid challengeId,
        string purpose,
        Guid? methodId,
        string emailAddress,
        string supplied,
        CancellationToken cancellationToken)
    {
        var proof = await CheckAsync(
            db, protection, userId, challengeId, purpose, methodId, emailAddress, supplied, cancellationToken);
        return proof is not null && await ConsumeAsync(db, proof, cancellationToken);
    }

    private static string Normalize(string value) =>
        new(value.Where(character => !char.IsWhiteSpace(character)).ToArray());
}
