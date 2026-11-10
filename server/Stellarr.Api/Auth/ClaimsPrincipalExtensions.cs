using System.Security.Claims;

namespace Stellarr.Api.Auth;

public static class ClaimsPrincipalExtensions
{
    public static Guid RequireUserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            ? userId
            : throw new InvalidOperationException("Authenticated principal has no valid user id.");

    /// <summary>The sign-in the cookie belongs to, or null when the claim is missing.</summary>
    public static Guid? FindSessionId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(SessionAuthentication.SessionIdClaim), out var sessionId)
            ? sessionId
            : null;
}
