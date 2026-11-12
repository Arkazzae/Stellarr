using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth;

/// <summary>
/// Signs accounts in. The cookie carries the account, its session version and
/// the id of a <see cref="UserSession"/> row, which is what makes a sign-in
/// revocable from the server side.
/// </summary>
public static class SessionAuthentication
{
    public const string VersionClaim = "stellarr:session-version";
    public const string SessionIdClaim = "stellarr:session-id";

    internal static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    /// <summary>The hard end of a sign-in that did not ask to stay signed in.</summary>
    internal static readonly TimeSpan ShortLifetime = TimeSpan.FromHours(12);

    /// <param name="shortLived">
    /// Whether the session row is short-lived. Every caller passes it, so a
    /// cookie issued again for an existing session keeps the lifetime it had.
    /// </param>
    public static async Task SignInAsync(HttpContext context, User user, Guid sessionId, bool shortLived)
    {
        var properties = new AuthenticationProperties();
        ApplyLifetime(properties, shortLived);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            CreatePrincipal(user, sessionId),
            properties);
    }

    public static ClaimsPrincipal CreatePrincipal(User user, Guid sessionId)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(VersionClaim, user.SessionVersion.ToString(CultureInfo.InvariantCulture)),
                new Claim(SessionIdClaim, sessionId.ToString()),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);
        return new ClaimsPrincipal(identity);
    }

    /// <summary>
    /// A kept sign-in gets a cookie that outlives the browser and renews itself
    /// while in use. A short-lived one gets a cookie the browser drops when it
    /// closes; its row ends after <see cref="ShortLifetime"/> either way.
    /// </summary>
    internal static void ApplyLifetime(AuthenticationProperties properties, bool shortLived)
    {
        properties.IsPersistent = !shortLived;
        properties.AllowRefresh = true;
        properties.ExpiresUtc = DateTimeOffset.UtcNow.Add(shortLived ? ShortLifetime : Lifetime);
    }

    /// <summary>A new, not yet saved session for a sign-in arriving on this request.</summary>
    public static UserSession CreateSession(
        HttpContext context,
        Guid userId,
        Messages messages,
        string primarySource = "password",
        DateTime? mfaCompletedAt = null,
        string? mfaEvidence = null,
        int securityVersion = 0,
        DateTime? authenticatedAt = null,
        bool shortLived = false)
    {
        var now = DateTime.UtcNow;
        var agent = context.Request.Headers.UserAgent.ToString().Trim();
        var expiresAt = now.Add(shortLived ? ShortLifetime : Lifetime);
        return new UserSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Device = agent.Length == 0 ? messages.Get(MessageKey.UnknownDevice) : agent[..Math.Min(agent.Length, 300)],
            IpAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = expiresAt,
            AbsoluteExpiresAt = expiresAt,
            PrimarySource = primarySource,
            AuthenticatedAt = authenticatedAt ?? now,
            MfaCompletedAt = mfaCompletedAt,
            MfaEvidence = mfaEvidence,
            SecurityVersion = securityVersion,
            ShortLived = shortLived,
        };
    }
}
