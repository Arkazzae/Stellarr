using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Auth.Security;

namespace Stellarr.Api.Auth;

public static class SessionCookie
{
    private static readonly TimeSpan SeenGranularity = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RenewalThreshold = TimeSpan.FromDays(15);

    /// <param name="allowPlainHttp">
    /// A <c>__Host-</c> cookie must always be Secure, and local development is
    /// served over plain HTTP. That setup gets a cookie of its own name instead
    /// of making the browser reject, or keep an older copy of, the real one.
    /// </param>
    public static AuthenticationBuilder AddSessionCookie(this AuthenticationBuilder authentication, bool allowPlainHttp) =>
        authentication.AddCookie(options =>
        {
            options.Cookie.Name = allowPlainHttp ? "stellarr-dev-session" : "__Host-stellarr-session";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = allowPlainHttp ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            options.Cookie.Path = "/";
            options.SlidingExpiration = true;
            options.ExpireTimeSpan = SessionAuthentication.Lifetime;
            // The client is an API consumer: it needs the status, not a redirect to a login page.
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
            options.Events.OnValidatePrincipal = ValidateAsync;
        });

    /// <summary>
    /// Honours the cookie only while the account is enabled, its session
    /// version is the one the cookie was issued for, and the session row it
    /// names is neither revoked nor expired. Active sessions are kept alive.
    /// </summary>
    private static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        if (ReadClaims(context.Principal) is not { } claims)
        {
            await RejectAsync(context);
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var cancellationToken = context.HttpContext.RequestAborted;
        var now = DateTime.UtcNow;
        var session = await db.UserSessions.AsNoTracking()
            .Where(x => x.Id == claims.SessionId && x.UserId == claims.UserId)
            .Select(x => new
            {
                x.LastSeenAt,
                x.ExpiresAt,
                x.AbsoluteExpiresAt,
                x.CreatedAt,
                x.RevokedAt,
                x.SecurityVersion,
                x.MfaCompletedAt,
                x.MfaEvidence,
                UserSessionVersion = x.User.SessionVersion,
                UserIsDisabled = x.User.IsDisabled,
            })
            .SingleOrDefaultAsync(cancellationToken);
        var absoluteExpiresAt = session?.AbsoluteExpiresAt ?? session?.CreatedAt.Add(SessionAuthentication.Lifetime);
        if (session is null || session.UserIsDisabled || session.SecurityVersion != claims.Version ||
            session.UserSessionVersion != claims.Version ||
            session.RevokedAt is not null || session.ExpiresAt <= now ||
            absoluteExpiresAt <= now)
        {
            await RejectAsync(context);
            return;
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        if (await MfaPolicy.IsRequiredAtLoginAsync(db, policy, claims.UserId, cancellationToken) &&
            !MfaPolicy.IsSatisfied(
                session.MfaCompletedAt is not null,
                session.MfaEvidence,
                policy.MfaRequirement))
        {
            await RejectAsync(context);
            return;
        }

        // Writing on every request would make each one a transaction; a
        // session seen minutes ago is fresh enough.
        if (session.LastSeenAt < now - SeenGranularity)
        {
            var renewed = now + SessionAuthentication.Lifetime;
            var hardEnd = absoluteExpiresAt.GetValueOrDefault(now);
            var expiresAt = session.ExpiresAt < now + RenewalThreshold
                ? (renewed < hardEnd ? renewed : hardEnd)
                : session.ExpiresAt;
            await db.UserSessions.Where(x => x.Id == claims.SessionId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(x => x.LastSeenAt, now)
                        .SetProperty(x => x.ExpiresAt, expiresAt),
                    cancellationToken);
        }
    }

    private static (Guid UserId, int Version, Guid SessionId)? ReadClaims(ClaimsPrincipal? principal) =>
        principal is not null &&
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) &&
        int.TryParse(
            principal.FindFirstValue(SessionAuthentication.VersionClaim),
            CultureInfo.InvariantCulture,
            out var version) &&
        principal.FindSessionId() is { } sessionId
            ? (userId, version, sessionId)
            : null;

    private static async Task RejectAsync(CookieValidatePrincipalContext context)
    {
        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }
}
