using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

public sealed record CockpitRecoverRequest(string? Reason);

/// <summary>
/// An account's security as the instance owner sees it: the second-step
/// methods, the recovery codes left, the trusted devices, the identity
/// provider links and the recent security history, never a secret. The
/// owner can recover an account that lost its second step, as the CLI does,
/// and remove a provider link.
/// </summary>
public static partial class CockpitEndpoints
{
    private const int SecurityHistoryShown = 10;

    private static async Task<IResult> GetUserSecurityAsync(
        Guid userId,
        HttpContext http,
        AppDbContext db,
        ExternalOidcOptions oidc,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (await MemberUserAsync(http, db, userId, cancellationToken) is not { } user)
        {
            return Results.NotFound();
        }

        var now = DateTime.UtcNow;
        var methods = await db.MfaMethods.AsNoTracking()
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .OrderBy(x => x.CreatedAt)
            .ToArrayAsync(cancellationToken);
        var identities = await db.ExternalIdentities.AsNoTracking()
            .Where(x => x.UserId == user.Id)
            .OrderBy(x => x.CreatedAt)
            .ToArrayAsync(cancellationToken);
        var events = await db.SecurityEvents.AsNoTracking()
            .Where(x => x.UserId == user.Id)
            .OrderByDescending(x => x.CreatedAt)
            .Take(SecurityHistoryShown)
            .ToArrayAsync(cancellationToken);
        return Results.Ok(new
        {
            userId = user.Id.ToString(),
            recoveryRequired = user.SecurityRecoveryRequired,
            methods = methods.Select(x => new
            {
                id = x.Id.ToString(),
                type = x.Type,
                name = x.Name,
                confirmed = x.ConfirmedAt is not null,
                createdAt = x.CreatedAt.AsUtc(),
                lastUsedAt = x.LastUsedAt.AsUtc(),
            }).ToArray(),
            remainingRecoveryCodes = await RecoveryCodes.RemainingAsync(db, user.Id, cancellationToken),
            trustedDevices = await db.TrustedDevices.AsNoTracking()
                .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now, cancellationToken),
            identities = identities.Select(x => new
            {
                id = x.Id.ToString(),
                name = AccountSecurityEndpoints.IdentityName(x, oidc, messages),
                issuer = x.Issuer,
                createdAt = x.CreatedAt.AsUtc(),
            }).ToArray(),
            events = events.Select(x => new
            {
                kind = x.Kind,
                ipAddress = x.IpAddress,
                createdAt = x.CreatedAt.AsUtc(),
            }).ToArray(),
        });
    }

    private static async Task<IResult> RecoverUserAsync(
        Guid userId,
        CockpitRecoverRequest request,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var actorId = http.User.RequireUserId();
        if (userId == actorId)
        {
            // Recovery ends every session of the account; from here that would
            // lock the owner out of the very panel that issued the credential.
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitCannotRecoverSelf));
        }

        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length is < 3 or > 500)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["reason"] = [messages.Get(MessageKey.CockpitRecoveryReasonInvalid)],
            });
        }

        if (await MemberUserAsync(http, db, userId, cancellationToken) is not { } user)
        {
            return Results.NotFound();
        }

        var server = http.RequireInstanceServer();
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var result = await AccountRecovery.RecoverAsync(
            db,
            user.Id,
            reason,
            policy,
            audit => StageAuditAsync(
                audit,
                server.Id,
                actorId,
                messages.Get(MessageKey.AuditAccountRecovered, ("name", user.DisplayName)),
                cancellationToken),
            cancellationToken);
        if (result is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitRecoverDisabled));
        }

        return Results.Ok(new
        {
            credential = result.Credential,
            expiresAt = result.ExpiresAt.AsUtc(),
            methodsRevoked = result.MethodsRevoked,
            trustedDevicesRevoked = result.TrustedDevicesRevoked,
            sessionsRevoked = result.SessionsRevoked,
        });
    }

    private static async Task<IResult> UnlinkUserIdentityAsync(
        Guid userId,
        Guid identityId,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (await MemberUserAsync(http, db, userId, cancellationToken) is not { } user)
        {
            return Results.NotFound();
        }

        var identity = await db.ExternalIdentities
            .SingleOrDefaultAsync(x => x.Id == identityId && x.UserId == user.Id, cancellationToken);
        if (identity is null)
        {
            return Results.NotFound();
        }

        db.ExternalIdentities.Remove(identity);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.IdentityUnlinked, http, $"operator: {identity.Issuer}",
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await StageAuditAsync(
            db,
            http.RequireInstanceServer().Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditIdentityUnlinked, ("name", user.DisplayName)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>An account that is a member of the instance server, the only ones Cockpit manages.</summary>
    private static Task<User?> MemberUserAsync(
        HttpContext http,
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        return db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == serverId && x.UserId == userId)
            .Select(x => x.User)
            .SingleOrDefaultAsync(cancellationToken);
    }
}
