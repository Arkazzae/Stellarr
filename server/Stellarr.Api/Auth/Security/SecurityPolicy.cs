using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth.Security;

/// <summary>
/// The limits and requirements read by authentication. An installation with no
/// settings row yet gets the documented defaults, which keep MFA optional.
/// </summary>
public sealed record SecurityPolicy(
    string MfaRequirement,
    int TrustedDeviceDays,
    int AuthChallengeMinutes,
    int EmailCodeMinutes,
    int EmailCodeCooldownSeconds,
    int EmailCodeMaxAttempts,
    int EmailCodeSendsPerHour,
    int CliRecoveryMinutes)
{
    public static SecurityPolicy Default { get; } = new(
        MfaRequirements.Optional,
        14,
        5,
        8,
        45,
        5,
        10,
        10);

    public static SecurityPolicy From(OperationsSettings? settings) => settings is null
        ? Default
        : new SecurityPolicy(
            MfaRequirements.Normalize(settings.MfaRequirement),
            settings.TrustedDeviceDays,
            settings.AuthChallengeMinutes,
            settings.EmailCodeMinutes,
            settings.EmailCodeCooldownSeconds,
            settings.EmailCodeMaxAttempts,
            settings.EmailCodeSendsPerHour,
            settings.CliRecoveryMinutes);

    public TimeSpan ChallengeLifetime => TimeSpan.FromMinutes(Math.Clamp(AuthChallengeMinutes, 1, 60));

    public TimeSpan EmailCodeLifetime => TimeSpan.FromMinutes(Math.Clamp(EmailCodeMinutes, 1, 60));

    public TimeSpan EmailCooldown => TimeSpan.FromSeconds(Math.Clamp(EmailCodeCooldownSeconds, 0, 600));

    public TimeSpan TrustedDeviceLifetime => TimeSpan.FromDays(Math.Clamp(TrustedDeviceDays, 1, 365));

    public TimeSpan CliRecoveryLifetime => TimeSpan.FromMinutes(Math.Clamp(CliRecoveryMinutes, 1, 60));
}

public static class MfaPolicy
{
    /// <summary>The bounded window in which an actual MFA proof may authorize a factor change.</summary>
    public static readonly TimeSpan FreshMfaWindow = TimeSpan.FromMinutes(5);

    /// <summary>Failed second-factor proofs an account may collect inside <see cref="FailureWindow"/>.</summary>
    public const int FailureBudget = 10;

    /// <summary>The window the account-wide failure budget counts over.</summary>
    public static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(15);

    public static async Task<SecurityPolicy> LoadAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var instanceServerId = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (instanceServerId is null)
        {
            return SecurityPolicy.Default;
        }

        return SecurityPolicy.From(await db.OperationsSettings.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ServerId == instanceServerId, cancellationToken));
    }

    /// <summary>
    /// The instance server's owner and roles with the manage-server permission
    /// are the people "admins" means. Roles are read as permission bits, never
    /// by their names.
    /// </summary>
    public static async Task<bool> IsInstanceAdminAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var instanceServerId = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (instanceServerId is null)
        {
            return false;
        }

        return await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == instanceServerId && x.UserId == userId)
            .Select(x => x.Role.IsOwner ||
                (x.Role.Permissions & ServerPrivileges.ManageServer) == ServerPrivileges.ManageServer)
            .SingleOrDefaultAsync(cancellationToken);
    }

    /// <summary>Whether a new sign-in must complete MFA or enrollment before a full session.</summary>
    public static async Task<bool> IsRequiredAtLoginAsync(
        AppDbContext db,
        SecurityPolicy policy,
        Guid userId,
        CancellationToken cancellationToken) =>
        policy.MfaRequirement switch
        {
            MfaRequirements.Everyone => true,
            MfaRequirements.Admins => await IsInstanceAdminAsync(db, userId, cancellationToken),
            _ => false,
        };

    /// <summary>
    /// Cockpit is the one surface where a remembered device is not enough. This
    /// asks that the authenticated session itself completed an actual MFA
    /// factor; unlike a factor lifecycle change it is not a short-TTL proof.
    /// </summary>
    public static bool RequiresCockpitMfa(SecurityPolicy policy) =>
        policy.MfaRequirement != MfaRequirements.Optional;

    /// <summary>
    /// A trusted device is a real second-factor proof for ordinary sessions, but
    /// it is recorded separately and never becomes <see cref="UserSession.MfaCompletedAt"/>.
    /// </summary>
    public static bool IsSatisfied(bool freshMfa, string? evidence, string requirement) =>
        freshMfa || (evidence == "trusted_device" && requirement != MfaRequirements.Cockpit);

    /// <summary>
    /// Whether this session may make a sensitive change now: the account has
    /// no second step to ask for, or the session passed a real one (not a
    /// trusted device) within <see cref="FreshMfaWindow"/>.
    /// </summary>
    public static async Task<bool> HasFreshSecondStepAsync(
        AppDbContext db,
        Guid userId,
        Guid? sessionId,
        CancellationToken cancellationToken)
    {
        if (!await HasConfirmedMethodAsync(db, userId, cancellationToken))
        {
            return true;
        }

        var since = DateTime.UtcNow - FreshMfaWindow;
        return sessionId is { } id && await db.UserSessions.AsNoTracking().AnyAsync(
            x => x.Id == id &&
                x.UserId == userId &&
                x.RevokedAt == null &&
                x.MfaCompletedAt != null &&
                x.MfaCompletedAt >= since,
            cancellationToken);
    }

    public static async Task<bool> HasConfirmedMethodAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken) =>
        await db.MfaMethods.AsNoTracking().AnyAsync(
            x => x.UserId == userId && x.ConfirmedAt != null && x.RevokedAt == null,
            cancellationToken);
}
