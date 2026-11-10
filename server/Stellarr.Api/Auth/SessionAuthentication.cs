using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Stellarr.Api.Domain;

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

    public static async Task SignInAsync(HttpContext context, User user, Guid sessionId)
    {
        var properties = new AuthenticationProperties();
        KeepSignedIn(properties);
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

    /// <summary>Makes the cookie outlive the browser session and renew itself while in use.</summary>
    internal static void KeepSignedIn(AuthenticationProperties properties)
    {
        properties.IsPersistent = true;
        properties.AllowRefresh = true;
        properties.ExpiresUtc = DateTimeOffset.UtcNow.Add(Lifetime);
    }

    /// <summary>A new, not yet saved session for a sign-in arriving on this request.</summary>
    public static UserSession CreateSession(HttpContext context, Guid userId)
    {
        var now = DateTime.UtcNow;
        var agent = context.Request.Headers.UserAgent.ToString().Trim();
        return new UserSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Device = agent.Length == 0 ? "Nieznane urządzenie" : agent[..Math.Min(agent.Length, 300)],
            IpAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = now.Add(Lifetime),
        };
    }
}
