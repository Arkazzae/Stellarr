using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth.Security;

/// <summary>What an operator's recovery ended, and the one credential it issued.</summary>
public sealed record AccountRecoveryResult(
    int MethodsRevoked,
    int TrustedDevicesRevoked,
    int SessionsRevoked,
    int HandoffsInvalidated,
    string Credential,
    DateTime ExpiresAt,
    int SessionVersion);

/// <summary>
/// An operator's recovery of an account that lost its second step, shared by
/// the CLI and Cockpit. In one serializable transaction it revokes every
/// method, trusted device, session, approved desktop handoff, unused recovery
/// code and earlier recovery credential, moves the account to a new security
/// version, marks it as waiting for recovery and issues one credential that
/// can only start the setup of a new method. Identity-provider links stay.
/// </summary>
public static class AccountRecovery
{
    /// <returns>The result, or null when the account is disabled by the time the transaction runs.</returns>
    public static async Task<AccountRecoveryResult?> RecoverAsync(
        AppDbContext db,
        Guid userId,
        string detail,
        SecurityPolicy policy,
        Func<AppDbContext, Task> audit,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {userId};",
            cancellationToken);
        var user = await db.Users.SingleAsync(x => x.Id == userId, cancellationToken);
        await db.Entry(user).ReloadAsync(cancellationToken);
        if (user.IsDisabled)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var verifiedEmailMethod = user.NormalizedEmail is { Length: > 0 } normalizedEmail
            ? await db.MfaMethods.AsNoTracking().FirstOrDefaultAsync(
                x => x.UserId == user.Id &&
                    x.Type == MfaMethodTypes.Email &&
                    x.ConfirmedAt != null &&
                    x.RevokedAt == null &&
                    x.EmailAddress == normalizedEmail,
                cancellationToken)
            : null;
        var alertRecipient = verifiedEmailMethod is null ? null : user.Email?.Trim();
        var methods = await db.MfaMethods
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        var devices = await db.TrustedDevices
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        var sessions = await db.UserSessions.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now, cancellationToken);
        await db.UserSessions
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        var handoffs = await db.DesktopBrowserLogins
            .Where(x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RedeemedAt, now), cancellationToken);
        await db.RecoveryCodes
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        await db.CliRecoveryCredentials
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);

        user.SessionVersion++;
        user.SecurityRecoveryRequired = true;
        var credential = SecurityTokens.Random(32);
        var recovery = new CliRecoveryCredential
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = SecurityTokens.Hash(credential),
            Reason = detail,
            SecurityVersion = user.SessionVersion,
            CreatedAt = now,
            ExpiresAt = now + policy.CliRecoveryLifetime,
        };
        db.CliRecoveryCredentials.Add(recovery);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.CliRecovery, null, $"operator recovery: {detail}", alertRecipient);
        await audit(db);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new AccountRecoveryResult(
            methods, devices, sessions, handoffs, credential, recovery.ExpiresAt, user.SessionVersion);
    }
}
