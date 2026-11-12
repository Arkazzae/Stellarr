using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;

namespace Stellarr.Api.Auth.Security;

/// <summary>The signed-in session a link to an identity provider is made for.</summary>
public sealed record IdentityLinkRequest(Guid UserId, Guid SessionId, int SecurityVersion, string ProviderId);

/// <summary>
/// Linking an account to an identity provider takes two requests. A JSON
/// request, behind the same fresh proof as any other security change, gets a
/// ticket; the browser then goes to the link address with it. The ticket is
/// bound to the account, the session, its security version and the provider,
/// and lasts a few minutes, so another site cannot start a link and a ticket
/// cannot be carried to another session.
///
/// The provider answers with a cross-site POST, which the session cookie does
/// not ride. So the session travels in the provider's protected state and is
/// checked again in the database when the answer comes, never by the cookie.
/// </summary>
public static class IdentityLinks
{
    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(5);

    private const string Purpose = "Stellarr.IdentityLink.v1";
    private const string StateItem = "stellarr.link";

    public static string IssueTicket(IDataProtectionProvider protection, IdentityLinkRequest request) =>
        protection.CreateProtector(Purpose).ToTimeLimitedDataProtector()
            .Protect(Write(request), TicketLifetime);

    public static IdentityLinkRequest? ReadTicket(IDataProtectionProvider protection, string? ticket)
    {
        if (string.IsNullOrWhiteSpace(ticket) || ticket.Length > 2048)
        {
            return null;
        }

        try
        {
            return Read(protection.CreateProtector(Purpose).ToTimeLimitedDataProtector().Unprotect(ticket));
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    public static void Remember(AuthenticationProperties properties, IdentityLinkRequest request) =>
        properties.Items[StateItem] = Write(request);

    public static IdentityLinkRequest? Recall(AuthenticationProperties? properties) =>
        properties?.Items.TryGetValue(StateItem, out var value) == true ? Read(value) : null;

    private static string Write(IdentityLinkRequest request) =>
        string.Join(
            '|',
            request.UserId.ToString("N"),
            request.SessionId.ToString("N"),
            request.SecurityVersion.ToString(CultureInfo.InvariantCulture),
            request.ProviderId);

    private static IdentityLinkRequest? Read(string? value)
    {
        var parts = value?.Split('|');
        return parts is { Length: 4 } &&
            Guid.TryParseExact(parts[0], "N", out var userId) &&
            Guid.TryParseExact(parts[1], "N", out var sessionId) &&
            int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var version) &&
            parts[3].Length > 0
                ? new IdentityLinkRequest(userId, sessionId, version, parts[3])
                : null;
    }
}
