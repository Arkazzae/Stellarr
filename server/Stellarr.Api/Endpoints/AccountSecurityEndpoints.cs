using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>The signed-in account's own security state, methods and history.</summary>
public static class AccountSecurityEndpoints
{
    public static IEndpointRouteBuilder MapAccountSecurityEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/me/security").RequireAuthorization();
        group.AddEndpointFilter(AuthEndpoints.NoStoreAsync);
        group.MapGet("", GetAsync);
        group.MapGet("/events", GetEventsAsync);
        group.MapPost("/mfa/enroll/start", StartEnrollmentAsync).RequireRateLimiting(RateLimitPolicies.SecurityWrite);
        group.MapPost("/mfa/reverify/start", StartReverificationAsync).RequireRateLimiting(RateLimitPolicies.SecurityWrite);
        group.MapPost("/mfa/{methodId:guid}/remove", RemoveMethodAsync).RequireRateLimiting(RateLimitPolicies.SecurityWrite);
        group.MapPost("/recovery/regenerate", RegenerateRecoveryAsync).RequireRateLimiting(RateLimitPolicies.SecurityWrite);
        group.MapDelete("/trusted/{deviceId:guid}", RevokeTrustedDeviceAsync);
        group.MapGet("/sessions", ListSessionsAsync);
        group.MapDelete("/sessions/{sessionId:guid}", RevokeSessionAsync);
        group.MapPost("/sessions/revoke-others", RevokeOtherSessionsAsync);
        return endpoints;
    }

    private static async Task<IResult> GetAsync(
        HttpContext context,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var userId = context.User.RequireUserId();
        var user = await db.Users.FindAsync([userId], cancellationToken);
        if (user is null)
        {
            return Results.NotFound();
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var methods = await AuthenticationFlow.ConfirmedMethodsAsync(db, userId, cancellationToken);
        var session = await CurrentSessionAsync(context, db, user, cancellationToken);
        var now = DateTime.UtcNow;
        var devices = await db.TrustedDevices.AsNoTracking()
            .Where(x => x.UserId == userId && x.RevokedAt == null && x.ExpiresAt > now)
            .OrderByDescending(x => x.CreatedAt)
            .ToArrayAsync(cancellationToken);
        var events = await db.SecurityEvents.AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.CreatedAt)
            .Take(20)
            .ToArrayAsync(cancellationToken);
        var required = methods.Count > 0 ||
            await MfaPolicy.IsRequiredAtLoginAsync(db, policy, userId, cancellationToken);
        var trusted = await TrustedDevices.FindAsync(db, userId, context, cancellationToken) is not null;
        var fresh = session?.MfaCompletedAt >= now - MfaPolicy.FreshMfaWindow;

        return Results.Ok(new AccountSecurityDto(
            policy.MfaRequirement,
            required,
            fresh,
            session?.MfaEvidence,
            session?.MfaCompletedAt.AsUtc(),
            trusted,
            methods.Select(x => x.ToDto()).ToArray(),
            await RecoveryCodes.RemainingAsync(db, userId, cancellationToken),
            devices.Select(x => x.ToDto()).ToArray(),
            events.Select(x => x.ToDto()).ToArray(),
            (int)MfaPolicy.FreshMfaWindow.TotalSeconds,
            (int)policy.TrustedDeviceLifetime.TotalDays,
            methods.Any(x => x.Type == MfaMethodTypes.Email),
            policy.EmailCodeCooldownSeconds,
            user.SecurityRecoveryRequired));
    }

    private static async Task<IResult> GetEventsAsync(
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = context.User.RequireUserId();
        var events = await db.SecurityEvents.AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .ToArrayAsync(cancellationToken);
        return Results.Ok(events.Select(x => x.ToDto()).ToArray());
    }

    private static async Task<IResult> StartEnrollmentAsync(
        MfaEnrollmentStartRequest? request,
        HttpContext context,
        AppDbContext db,
        PasswordService passwords,
        Messages messages,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        var userId = context.User.RequireUserId();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {userId};",
            cancellationToken);
        var user = await db.Users.FindAsync([userId], cancellationToken);
        if (user is null)
        {
            return Results.NotFound();
        }

        if (user.IsDisabled || user.SecurityRecoveryRequired)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        var current = await CurrentSessionAsync(context, db, user, cancellationToken);
        if (current is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        var hasMethods = await MfaPolicy.HasConfirmedMethodAsync(db, user.Id, cancellationToken);
        var allowed = hasMethods
            ? IsRecentMfa(current)
            : IsRecentPrimary(current) ||
                (request?.Password is { } password && passwords.Verify(password, user.PasswordHash));
        if (!allowed)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var challenge = await AuthenticationFlow.CreateChallengeAsync(
            db, context, user, current.PrimarySource,
            AuthChallengePurposes.Enrollment, policy, messages, cancellationToken,
            parentSessionId: current.Id);
        var methods = await AuthenticationFlow.ConfirmedMethodsAsync(db, user.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(await AuthenticationFlow.DescribeAsync(
            db, context, user, challenge, methods, policy, cancellationToken));
    }

    /// <summary>Starts a fresh actual-MFA proof for an already signed-in account.</summary>
    private static async Task<IResult> StartReverificationAsync(
        HttpContext context,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        var userId = context.User.RequireUserId();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {userId};",
            cancellationToken);
        var user = await db.Users.FindAsync([userId], cancellationToken);
        if (user is null)
        {
            return Results.NotFound();
        }

        if (user.IsDisabled || user.SecurityRecoveryRequired)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        var current = await CurrentSessionAsync(context, db, user, cancellationToken);
        if (current is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        if (!await MfaPolicy.HasConfirmedMethodAsync(db, user.Id, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.SecurityMethodUnavailable));
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var challenge = await AuthenticationFlow.CreateChallengeAsync(
            db, context, user, current.PrimarySource,
            AuthChallengePurposes.Reverify, policy, messages, cancellationToken,
            parentSessionId: current.Id);
        var methods = await AuthenticationFlow.ConfirmedMethodsAsync(db, user.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(await AuthenticationFlow.DescribeAsync(
            db, context, user, challenge, methods, policy, cancellationToken));
    }

    private static async Task<IResult> RemoveMethodAsync(
        Guid methodId,
        RemoveMfaMethodRequest request,
        HttpContext context,
        AppDbContext db,
        PasswordService passwords,
        Messages messages,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        var userId = context.User.RequireUserId();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {userId};",
            cancellationToken);

        var user = await db.Users.FindAsync([userId], cancellationToken);
        if (user is null)
        {
            return Results.NotFound();
        }

        if (!await CanChangeSecurityAsync(context, db, user, request.Password, passwords, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        var method = await db.MfaMethods.SingleOrDefaultAsync(
            x => x.Id == methodId && x.UserId == user.Id && x.RevokedAt == null,
            cancellationToken);
        if (method is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: messages.Get(MessageKey.SecurityMethodNotFound));
        }

        var remaining = await db.MfaMethods.CountAsync(
            x => x.UserId == user.Id && x.Id != methodId && x.ConfirmedAt != null && x.RevokedAt == null,
            cancellationToken);
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        if (remaining == 0 &&
            await MfaPolicy.IsRequiredAtLoginAsync(db, policy, user.Id, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.SecurityMethodUnavailable));
        }

        var now = DateTime.UtcNow;
        var alertRecipient = await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken);
        method.RevokedAt = now;
        user.SessionVersion++;
        await TrustedDevices.RevokeAllAsync(db, user.Id, now, cancellationToken);
        await db.UserSessions
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        if (remaining == 0)
        {
            await db.RecoveryCodes
                .Where(x => x.UserId == user.Id && x.UsedAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        }

        var currentSessionId = context.User.FindSessionId()!.Value;
        await db.SaveChangesAsync(cancellationToken);
        await db.UserSessions
            .Where(x => x.Id == currentSessionId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(x => x.RevokedAt, (DateTime?)null)
                    .SetProperty(x => x.SecurityVersion, user.SessionVersion)
                    .SetProperty(x => x.ExpiresAt, now.Add(SessionAuthentication.Lifetime)),
                cancellationToken);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.MethodRemoved, context, method.Type, alertRecipient);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, currentSessionId);
        return Results.NoContent();
    }

    private static async Task<IResult> RegenerateRecoveryAsync(
        RegenerateRecoveryCodesRequest request,
        HttpContext context,
        AppDbContext db,
        PasswordService passwords,
        Messages messages,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        var userId = context.User.RequireUserId();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {userId};",
            cancellationToken);
        var user = await db.Users.FindAsync([userId], cancellationToken);
        if (user is null)
        {
            return Results.NotFound();
        }

        if (!await CanChangeSecurityAsync(context, db, user, request.Password, passwords, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: messages.Get(MessageKey.SecurityFreshMfaRequired));
        }

        if (!await MfaPolicy.HasConfirmedMethodAsync(db, user.Id, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.SecurityMethodUnavailable));
        }

        var now = DateTime.UtcNow;
        var codes = await RecoveryCodes.RegenerateAsync(db, user.Id, now, cancellationToken);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.RecoveryCodesRegenerated, context, "",
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new { recoveryCodes = codes });
    }

    private static async Task<IResult> RevokeTrustedDeviceAsync(
        Guid deviceId,
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = context.User.RequireUserId();
        var now = DateTime.UtcNow;
        var changed = await db.TrustedDevices
            .Where(x => x.Id == deviceId && x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        if (changed == 0)
        {
            return Results.NotFound();
        }

        SecurityEvents.Record(
            db, userId, SecurityEventKinds.TrustedDeviceRemoved, context, "",
            await SecurityEvents.VerifiedEmailAsync(db, userId, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>The account's signed-in devices, the current one marked.</summary>
    private static async Task<IResult> ListSessionsAsync(
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = context.User.RequireUserId();
        var currentId = context.User.FindSessionId();
        var now = DateTime.UtcNow;
        var sessions = await db.UserSessions.AsNoTracking()
            .Where(x => x.UserId == userId && x.RevokedAt == null && x.ExpiresAt > now)
            .OrderByDescending(x => x.LastSeenAt)
            .Take(100)
            .ToArrayAsync(cancellationToken);
        return Results.Ok(sessions.Select(session => session.ToOwnDto(session.Id == currentId)));
    }

    /// <summary>
    /// Signs one of the account's other devices out. The current session ends
    /// through logout instead, so this cannot strand the caller.
    /// </summary>
    private static async Task<IResult> RevokeSessionAsync(
        Guid sessionId,
        HttpContext context,
        AppDbContext db,
        HubConnectionRegistry connections,
        CancellationToken cancellationToken)
    {
        if (context.User.FindSessionId() == sessionId)
        {
            return Results.Conflict();
        }

        var userId = context.User.RequireUserId();
        var now = DateTime.UtcNow;
        var changed = await db.UserSessions
            .Where(x => x.Id == sessionId && x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        if (changed == 0)
        {
            return Results.NotFound();
        }

        SecurityEvents.Record(db, userId, SecurityEventKinds.SessionRevoked, context, "device");
        await db.SaveChangesAsync(cancellationToken);
        connections.AbortSession(sessionId);
        return Results.NoContent();
    }

    /// <summary>Signs out every device of the account except the one asking.</summary>
    private static async Task<IResult> RevokeOtherSessionsAsync(
        HttpContext context,
        AppDbContext db,
        HubConnectionRegistry connections,
        CancellationToken cancellationToken)
    {
        var userId = context.User.RequireUserId();
        var currentId = context.User.FindSessionId();
        var now = DateTime.UtcNow;
        var others = await db.UserSessions
            .Where(x => x.UserId == userId && x.RevokedAt == null && x.Id != currentId)
            .Select(x => x.Id)
            .ToArrayAsync(cancellationToken);
        if (others.Length == 0)
        {
            return Results.NoContent();
        }

        await db.UserSessions
            .Where(x => others.Contains(x.Id) && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        SecurityEvents.Record(db, userId, SecurityEventKinds.SessionRevoked, context, "others");
        await db.SaveChangesAsync(cancellationToken);
        foreach (var id in others)
        {
            connections.AbortSession(id);
        }

        return Results.NoContent();
    }

    /// <summary>
    /// A factor lifecycle change needs a recent actual MFA proof for an
    /// MFA-enabled account. Password or remembered trust alone is not enough.
    /// First enrollment instead accepts a recent primary proof or the current
    /// password.
    /// </summary>
    private static async Task<bool> CanChangeSecurityAsync(
        HttpContext context,
        AppDbContext db,
        User user,
        string? password,
        PasswordService passwords,
        CancellationToken cancellationToken)
    {
        if (user.IsDisabled || user.SecurityRecoveryRequired)
        {
            return false;
        }

        var session = await CurrentSessionAsync(context, db, user, cancellationToken);
        if (session is null)
        {
            return false;
        }

        if (await MfaPolicy.HasConfirmedMethodAsync(db, user.Id, cancellationToken))
        {
            return IsRecentMfa(session);
        }

        return (password is not null && passwords.Verify(password, user.PasswordHash)) ||
            IsRecentPrimary(session);
    }

    private static bool IsRecentMfa(UserSession session) =>
        session.MfaCompletedAt is { } completed &&
        completed >= DateTime.UtcNow - MfaPolicy.FreshMfaWindow;

    private static bool IsRecentPrimary(UserSession session) =>
        (session.AuthenticatedAt ?? session.CreatedAt) >= DateTime.UtcNow - MfaPolicy.FreshMfaWindow;

    private static Task<UserSession?> CurrentSessionAsync(
        HttpContext context,
        AppDbContext db,
        User user,
        CancellationToken cancellationToken)
    {
        if (context.User.FindSessionId() is not { } sessionId)
        {
            return Task.FromResult<UserSession?>(null);
        }

        var now = DateTime.UtcNow;
        var legacyCutoff = now - SessionAuthentication.Lifetime;
        return db.UserSessions.AsNoTracking().SingleOrDefaultAsync(
            x => x.Id == sessionId &&
                x.UserId == user.Id &&
                !user.IsDisabled &&
                x.RevokedAt == null &&
                x.ExpiresAt > now &&
                (x.AbsoluteExpiresAt > now ||
                    (x.AbsoluteExpiresAt == null && x.CreatedAt > legacyCutoff)) &&
                x.SecurityVersion == user.SessionVersion,
            cancellationToken);
    }
}
