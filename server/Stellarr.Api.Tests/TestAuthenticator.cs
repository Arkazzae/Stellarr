using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Cbor;
using Fido2NetLib.Objects;

namespace Stellarr.Api.Tests;

/// <summary>
/// A software authenticator for the tests: a P-256 key that signs real
/// registrations (packed self attestation) and assertions, so the server's
/// verification runs exactly as it does for a phone or a security key.
/// </summary>
internal sealed class TestAuthenticator : IDisposable
{
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public byte[] CredentialId { get; } = RandomNumberGenerator.GetBytes(32);

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes)
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] FromBase64Url(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '='));
    }

    private static byte[] ClientData(string type, byte[] challenge, string origin) =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            type,
            challenge = Base64Url(challenge),
            origin,
            crossOrigin = false,
        });

    private byte[] Sign(byte[] authData, byte[] clientData)
    {
        byte[] signed = [.. authData, .. SHA256.HashData(clientData)];
        return _key.SignData(signed, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    }

    /// <summary>Answers <c>navigator.credentials.create</c> for the given options.</summary>
    public AuthenticatorAttestationRawResponse Register(
        string rpId,
        byte[] challenge,
        string origin,
        AuthenticatorFlags flags = AuthenticatorFlags.UP | AuthenticatorFlags.UV | AuthenticatorFlags.AT)
    {
        var publicKey = new CredentialPublicKey(_key, COSE.Algorithm.ES256);
        var credential = new AttestedCredentialData(Guid.Empty, CredentialId, publicKey);
        var authData = new AuthenticatorData(
            SHA256.HashData(Encoding.UTF8.GetBytes(rpId)), flags, 0, credential).ToByteArray();
        var clientData = ClientData("webauthn.create", challenge, origin);
        var attestation = new CborMap
        {
            { "fmt", "packed" },
            { "authData", authData },
            {
                "attStmt",
                new CborMap { { "alg", (int)COSE.Algorithm.ES256 }, { "sig", Sign(authData, clientData) } }
            },
        }.Encode();
        return new AuthenticatorAttestationRawResponse
        {
            Id = Base64Url(CredentialId),
            RawId = CredentialId,
            Type = PublicKeyCredentialType.PublicKey,
            ClientExtensionResults = new AuthenticationExtensionsClientOutputs(),
            Response = new AuthenticatorAttestationRawResponse.AttestationResponse
            {
                AttestationObject = attestation,
                ClientDataJson = clientData,
                Transports = [AuthenticatorTransport.Internal],
            },
        };
    }

    /// <summary>Answers <c>navigator.credentials.get</c> for the given options.</summary>
    public AuthenticatorAssertionRawResponse Assert(
        string rpId,
        byte[] challenge,
        string origin,
        byte[]? userHandle,
        uint counter = 0,
        AuthenticatorFlags flags = AuthenticatorFlags.UP | AuthenticatorFlags.UV)
    {
        var authData = new AuthenticatorData(
            SHA256.HashData(Encoding.UTF8.GetBytes(rpId)), flags, counter, null).ToByteArray();
        var clientData = ClientData("webauthn.get", challenge, origin);
        return new AuthenticatorAssertionRawResponse
        {
            Id = Base64Url(CredentialId),
            RawId = CredentialId,
            Type = PublicKeyCredentialType.PublicKey,
            ClientExtensionResults = new AuthenticationExtensionsClientOutputs(),
            Response = new AuthenticatorAssertionRawResponse.AssertionResponse
            {
                AuthenticatorData = authData,
                ClientDataJson = clientData,
                Signature = Sign(authData, clientData),
                UserHandle = userHandle,
            },
        };
    }

    public void Dispose() => _key.Dispose();
}
