using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth.Security;

public enum ChallengeStatus
{
    Valid,
    Missing,
    Expired,
    Consumed,
    AttemptLimit,
    SecurityChanged,
    UserUnavailable,
}

public sealed record ChallengeCheck(AuthChallenge? Challenge, ChallengeStatus Status);

public sealed record AuthStart(
    MfaChallengeDto? Challenge,
    UserSession? Session,
    bool RecoveryRequired = false);

/// <summary>
/// The common decision after every primary proof: password, registration, OIDC
/// or CLI recovery. It either creates an ordinary session or a purpose-bound
/// pre-authentication capability, never both.
/// </summary>
public static class AuthenticationFlow
{
    public static async Task<AuthStart> StartAsync(
        AppDbContext db,
        HttpContext context,
        User user,
        string primarySource,
        SecurityPolicy policy,
        Messages messages,
        CancellationToken cancellationToken,
        bool? requiredOverride = null,
        bool shortLived = false)
    {
        var methods = await ConfirmedMethodsAsync(db, user.Id, cancellationToken);
        if (user.SecurityRecoveryRequired)
        {
            return new AuthStart(null, null, RecoveryRequired: true);
        }

        var required = requiredOverride ??
            await MfaPolicy.IsRequiredAtLoginAsync(db, policy, user.Id, cancellationToken);
        if (methods.Count == 0 && !required)
        {
            return new AuthStart(null, SessionAuthentication.CreateSession(
                context, user.Id, messages, primarySource, securityVersion: user.SessionVersion,
                shortLived: shortLived));
        }

        var purpose = methods.Count == 0
            ? AuthChallengePurposes.Enrollment
            : AuthChallengePurposes.Mfa;
        var challenge = await CreateChallengeAsync(
            db, context, user, primarySource, purpose, policy, messages, cancellationToken,
            shortLived: shortLived);
        return new AuthStart(
            await DescribeAsync(db, context, user, challenge, methods, policy, cancellationToken),
            null);
    }

    public static async Task<AuthChallenge> CreateChallengeAsync(
        AppDbContext db,
        HttpContext context,
        User user,
        string primarySource,
        string purpose,
        SecurityPolicy policy,
        Messages messages,
        CancellationToken cancellationToken,
        Guid? parentSessionId = null,
        bool shortLived = false)
    {
        var now = DateTime.UtcNow;
        var secret = SecurityTokens.Random(32);
        var challenge = new AuthChallenge
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Purpose = purpose,
            SecretHash = SecurityTokens.Hash(secret),
            PrimarySource = primarySource,
            ParentSessionId = parentSessionId,
            SecurityVersion = user.SessionVersion,
            ShortLived = shortLived,
            MaxAttempts = 5,
            CreatedAt = now,
            ExpiresAt = now + policy.ChallengeLifetime,
        };
        db.AuthChallenges.Add(challenge);
        await db.AuthChallenges
            .Where(x => x.UserId == user.Id && x.ConsumedAt == null && x.ExpiresAt <= now)
            .ExecuteDeleteAsync(cancellationToken);
        SecurityCookies.SetPreauth(context, challenge.Id, secret, challenge.ExpiresAt);
        return challenge;
    }

    public static async Task<MfaChallengeDto> DescribeAsync(
        AppDbContext db,
        HttpContext context,
        User user,
        AuthChallenge challenge,
        IReadOnlyList<MfaMethod> methods,
        SecurityPolicy policy,
        CancellationToken cancellationToken)
    {
        var trusted = challenge.Purpose != AuthChallengePurposes.Reverify &&
            await TrustedDevices.FindAsync(db, user.Id, context, cancellationToken) is not null;
        var status = challenge.Purpose is AuthChallengePurposes.Mfa or AuthChallengePurposes.Reverify
            ? "mfa_required"
            : "mfa_enrollment_required";
        return new MfaChallengeDto(
            status,
            challenge.Id.ToString(),
            challenge.Purpose,
            challenge.ExpiresAt.AsUtc(),
            methods.Select(x => x.ToDto()).ToArray(),
            trusted,
            methods.Any(x => x.Type == MfaMethodTypes.Email),
            (int)policy.TrustedDeviceLifetime.TotalDays);
    }

    public static async Task<ChallengeCheck> ValidateAsync(
        AppDbContext db,
        HttpContext context,
        string challengeId,
        string? purpose,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(challengeId, out var id) ||
            SecurityCookies.ReadPreauth(context) is not { } cookie ||
            cookie.Id != id)
        {
            return new ChallengeCheck(null, ChallengeStatus.Missing);
        }

        var challenge = await db.AuthChallenges.Include(x => x.User)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (challenge is null || !SecurityTokens.Matches(cookie.Secret, challenge.SecretHash))
        {
            return new ChallengeCheck(null, ChallengeStatus.Missing);
        }

        if (purpose is not null && challenge.Purpose != purpose)
        {
            return new ChallengeCheck(null, ChallengeStatus.Missing);
        }

        var now = DateTime.UtcNow;
        if (challenge.ConsumedAt is not null)
        {
            return new ChallengeCheck(null, ChallengeStatus.Consumed);
        }

        if (challenge.ExpiresAt <= now)
        {
            return new ChallengeCheck(null, ChallengeStatus.Expired);
        }

        if (challenge.Attempts >= challenge.MaxAttempts)
        {
            return new ChallengeCheck(null, ChallengeStatus.AttemptLimit);
        }

        if (challenge.User.IsDisabled ||
            challenge.User.SessionVersion != challenge.SecurityVersion ||
            (challenge.User.SecurityRecoveryRequired && challenge.Purpose != AuthChallengePurposes.Recovery) ||
            (challenge.Purpose == AuthChallengePurposes.Recovery && !challenge.User.SecurityRecoveryRequired))
        {
            return new ChallengeCheck(null, ChallengeStatus.SecurityChanged);
        }

        if (challenge.ParentSessionId is { } parentSessionId)
        {
            var legacyCutoff = now - SessionAuthentication.Lifetime;
            var parentActive = await db.UserSessions.AsNoTracking().AnyAsync(
                x => x.Id == parentSessionId &&
                    x.UserId == challenge.UserId &&
                    x.RevokedAt == null &&
                    x.ExpiresAt > now &&
                    (x.AbsoluteExpiresAt > now ||
                        (x.AbsoluteExpiresAt == null && x.CreatedAt > legacyCutoff)) &&
                    x.SecurityVersion == challenge.User.SessionVersion,
                cancellationToken);
            if (!parentActive)
            {
                return new ChallengeCheck(null, ChallengeStatus.SecurityChanged);
            }
        }

        return new ChallengeCheck(challenge, ChallengeStatus.Valid);
    }

    public static async Task<bool> ConsumeAsync(
        AppDbContext db,
        Guid challengeId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var changed = await db.AuthChallenges
            .Where(x => x.Id == challengeId && x.ConsumedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ConsumedAt, now), cancellationToken);
        return changed == 1;
    }

    /// <summary>Atomically spends one attempt and closes the challenge at its budget.</summary>
    public static async Task FailAttemptAsync(
        AppDbContext db,
        AuthChallenge challenge,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await db.AuthChallenges
            .Where(x => x.Id == challenge.Id && x.ConsumedAt == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(x => x.Attempts, x => x.Attempts + 1)
                    .SetProperty(x => x.ConsumedAt, x => x.Attempts + 1 >= x.MaxAttempts ? now : x.ConsumedAt),
                cancellationToken);
    }

    public static async Task<List<MfaMethod>> ConfirmedMethodsAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken) =>
        await db.MfaMethods.AsNoTracking()
            .Where(x => x.UserId == userId && x.ConfirmedAt != null && x.RevokedAt == null)
            .OrderBy(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
}
