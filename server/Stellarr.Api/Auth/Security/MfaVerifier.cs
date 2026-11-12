using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth.Security;

public static class MfaVerifier
{
    /// <summary>Checks the code without spending its timestep.</summary>
    public static bool TryVerifyTotpProof(
        IDataProtectionProvider protection,
        MfaMethod method,
        string code,
        out long step)
    {
        step = 0;
        if (method.Type != MfaMethodTypes.Totp || method.ProtectedSecret is null)
        {
            return false;
        }

        string secret;
        try
        {
            secret = SecurityProtection.UnprotectTotp(protection, method.UserId, method.Id, method.ProtectedSecret);
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return false;
        }

        return TotpService.Verify(secret, code, out step);
    }

    /// <summary>Spends one timestep atomically; the caller may run it in its own transaction.</summary>
    public static async Task<bool> ConsumeTotpStepAsync(
        AppDbContext db,
        Guid methodId,
        Guid userId,
        long step,
        DateTime now,
        bool allowPending,
        CancellationToken cancellationToken)
    {
        var query = db.MfaMethods
            .Where(x => x.Id == methodId &&
                x.UserId == userId &&
                x.RevokedAt == null &&
                (x.LastTotpStep == null || x.LastTotpStep < step));
        if (!allowPending)
        {
            query = query.Where(x => x.ConfirmedAt != null);
        }

        var changed = await query
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(x => x.LastTotpStep, step)
                    .SetProperty(x => x.LastUsedAt, now),
                cancellationToken);
        return changed == 1;
    }

    /// <summary>Accepts one RFC 6238 step at most once, atomically in the method row.</summary>
    public static async Task<bool> VerifyTotpAsync(
        AppDbContext db,
        IDataProtectionProvider protection,
        MfaMethod method,
        string code,
        CancellationToken cancellationToken,
        bool allowPending = false)
    {
        if (!TryVerifyTotpProof(protection, method, code, out var step))
        {
            return false;
        }

        return await ConsumeTotpStepAsync(
            db, method.Id, method.UserId, step, DateTime.UtcNow, allowPending, cancellationToken);
    }

    public static Task<bool> ConsumeRecoveryCodeAsync(
        AppDbContext db,
        Guid userId,
        string code,
        CancellationToken cancellationToken) =>
        RecoveryCodes.ConsumeAsync(db, userId, code, DateTime.UtcNow, cancellationToken);
}
