using System.Net;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth.Security;

/// <summary>
/// The relying party passkeys are registered with: the host of
/// <c>Operations:PublicUrl</c>, the address mail links already use. It is
/// read on every use and never taken from the request, so a forged Host
/// header cannot move it. Without an HTTPS address (or http on localhost)
/// passkeys are not offered, since browsers refuse them anyway.
/// </summary>
public sealed class PasskeyRelyingParty(IConfiguration configuration)
{
    /// <summary>A hint to the browser; the server keeps its own limit through the challenge.</summary>
    private const int BrowserTimeoutMilliseconds = 120_000;

    public bool Available => Create() is not null;

    public IFido2? Create()
    {
        var publicUrl = (configuration["Operations:PublicUrl"] ?? "").Trim();
        if (!Uri.TryCreate(publicUrl, UriKind.Absolute, out var uri) ||
            uri.HostNameType != UriHostNameType.Dns ||
            IPAddress.TryParse(uri.Host, out _))
        {
            return null;
        }

        var secure = uri.Scheme == Uri.UriSchemeHttps ||
            (uri.Scheme == Uri.UriSchemeHttp && uri.Host == "localhost");
        if (!secure)
        {
            return null;
        }

        return new Fido2(new Fido2Configuration
        {
            RPID = uri.Host,
            RPName = "Stellarr",
            Origins = new HashSet<string>(StringComparer.Ordinal) { uri.GetLeftPart(UriPartial.Authority) },
            ChallengeSize = 32,
            Timeout = BrowserTimeoutMilliseconds,
        });
    }
}

public static class Passkeys
{
    /// <summary>
    /// The handle stored with a passkey: the account id. It is random, says
    /// nothing about the person, and stays the same for every passkey of the
    /// account, as WebAuthn expects.
    /// </summary>
    public static byte[] UserHandle(Guid userId) => userId.ToByteArray();

    /// <summary>The account's passkeys that still count: their method is confirmed and not revoked.</summary>
    public static IQueryable<WebAuthnCredential> Active(AppDbContext db) =>
        db.WebAuthnCredentials.Where(x =>
            x.Method.Type == MfaMethodTypes.Passkey &&
            x.Method.ConfirmedAt != null &&
            x.Method.RevokedAt == null);

    public static async Task<List<PublicKeyCredentialDescriptor>> DescriptorsAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var credentials = await Active(db).AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => new { x.CredentialId, x.Transports })
            .ToListAsync(cancellationToken);
        return credentials
            .Select(x => new PublicKeyCredentialDescriptor(
                PublicKeyCredentialType.PublicKey, x.CredentialId, ReadTransports(x.Transports)))
            .ToList();
    }

    public static string WriteTransports(AuthenticatorTransport[]? transports) =>
        transports is { Length: > 0 } ? JsonSerializer.Serialize(transports) : "";

    private static AuthenticatorTransport[]? ReadTransports(string stored)
    {
        if (stored.Length == 0)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<AuthenticatorTransport[]>(stored);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Checks a signed answer against the stored options and a credential the
    /// caller has already tied to the right account, then records the new
    /// signature count. False for any failure: a bad signature, a wrong
    /// origin or relying party, a missing user verification, or another
    /// request that used the same count first.
    /// </summary>
    public static async Task<bool> VerifyAsync(
        AppDbContext db,
        IFido2 fido,
        WebAuthnCredential credential,
        AuthenticatorAssertionRawResponse response,
        AssertionOptions options,
        CancellationToken cancellationToken)
    {
        VerifyAssertionResult result;
        try
        {
            result = await fido.MakeAssertionAsync(new MakeAssertionParams
            {
                AssertionResponse = response,
                OriginalOptions = options,
                StoredPublicKey = credential.PublicKey,
                StoredSignatureCounter = (uint)credential.SignCount,
                // The caller matched the credential to the account already; a
                // handle, when the authenticator returns one, must agree too.
                IsUserHandleOwnerOfCredentialIdCallback = (args, _) => Task.FromResult(
                    args.CredentialId.AsSpan().SequenceEqual(credential.CredentialId) &&
                    args.UserHandle.AsSpan().SequenceEqual(credential.UserHandle)),
            }, cancellationToken);
        }
        catch (Fido2VerificationException)
        {
            return false;
        }

        var now = DateTime.UtcNow;
        var counted = await db.WebAuthnCredentials
            .Where(x => x.Id == credential.Id && x.SignCount == credential.SignCount)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(x => x.SignCount, (long)result.SignCount)
                    .SetProperty(x => x.BackedUp, result.IsBackedUp)
                    .SetProperty(x => x.LastUsedAt, now),
                cancellationToken);
        if (counted != 1)
        {
            return false;
        }

        await db.MfaMethods.Where(x => x.Id == credential.MethodId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.LastUsedAt, now), cancellationToken);
        return true;
    }
}
