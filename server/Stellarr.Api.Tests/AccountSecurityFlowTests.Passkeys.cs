using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// Passkeys and security keys as a second step, through the real endpoints
/// and the real verification: the test authenticator signs every answer.
/// </summary>
public sealed partial class AccountSecurityFlowTests
{
    private const string PasskeyOrigin = "https://chat.test";

    [Fact]
    public async Task PasskeyIsSetUpAndThenConfirmsSignIn()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var setup = Client(factory);
        await LoginAsync(setup, account.Username);

        using var key = new TestAuthenticator();
        var codes = await EnrollPasskeyAsync(setup, key);

        Assert.Equal(10, codes.Length);
        await using (var scope = factory.OpenScope(out var db))
        {
            var method = await db.MfaMethods.SingleAsync(x => x.UserId == account.Id);
            Assert.Equal(MfaMethodTypes.Passkey, method.Type);
            Assert.Equal("Laptop", method.Name);
            Assert.NotNull(method.ConfirmedAt);
            var credential = await db.WebAuthnCredentials.SingleAsync(x => x.UserId == account.Id);
            Assert.Equal(method.Id, credential.MethodId);
            Assert.Equal(key.CredentialId, credential.CredentialId);
            Assert.Equal(account.Id.ToByteArray(), credential.UserHandle);
        }

        using var client = Client(factory);
        var challenge = await LoginAsync(client, account.Username);
        Assert.Equal("mfa_required", challenge.GetProperty("status").GetString());
        Assert.True(challenge.GetProperty("passkeyAvailable").GetBoolean());
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var options = await PasskeyOptionsAsync(client, challengeId);
        Assert.Equal("required", options.GetProperty("userVerification").GetString());
        Assert.Equal(
            TestAuthenticator.Base64Url(key.CredentialId),
            options.GetProperty("allowCredentials")[0].GetProperty("id").GetString());

        using var verify = await client.PostAsJsonAsync(
            "/api/auth/mfa/passkey/verify",
            new { challengeId, response = Sign(key, options, counter: 1) });

        verify.EnsureSuccessStatusCode();
        Assert.Equal(account.Id.ToString(), await SignedInIdAsync(client));
        await using (var scope = factory.OpenScope(out var db))
        {
            var session = await db.UserSessions
                .Where(x => x.UserId == account.Id).OrderByDescending(x => x.CreatedAt).FirstAsync();
            Assert.Equal(MfaMethodTypes.Passkey, session.MfaEvidence);
            Assert.NotNull(session.MfaCompletedAt);
            Assert.Equal(1, (await db.WebAuthnCredentials.SingleAsync(x => x.UserId == account.Id)).SignCount);
        }
    }

    [Fact]
    public async Task PasskeyAnswerIsRefusedWhenAnyPartOfItIsWrong()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var setup = Client(factory);
        await LoginAsync(setup, account.Username);
        using var key = new TestAuthenticator();
        await EnrollPasskeyAsync(setup, key);
        using var stranger = new TestAuthenticator();
        // A real passkey, registered by another account.
        var other = await CreateAccountAsync(factory);
        using var otherClient = Client(factory);
        await LoginAsync(otherClient, other.Username);
        using var otherKey = new TestAuthenticator();
        await EnrollPasskeyAsync(otherClient, otherKey);
        int sessionsBefore;
        await using (var scope = factory.OpenScope(out var db))
        {
            sessionsBefore = await db.UserSessions.CountAsync(x => x.UserId == account.Id);
        }

        var refusals = new (string Case, Func<JsonElement, object> Answer)[]
        {
            ("another key's signature", options => WithCredential(Sign(stranger, options), key.CredentialId)),
            ("no user verification", options => Sign(key, options, flags: AuthenticatorFlags.UP)),
            ("another origin", options => Sign(key, options, origin: "https://elsewhere.test")),
            ("another relying party", options => Sign(key, options, rpId: "elsewhere.test")),
            ("a key the account does not have", options => Sign(stranger, options)),
            ("another account's passkey", options => Sign(otherKey, options)),
        };
        foreach (var (name, answer) in refusals)
        {
            using var client = Client(factory);
            var challenge = await LoginAsync(client, account.Username);
            var challengeId = challenge.GetProperty("challengeId").GetString()!;
            var options = await PasskeyOptionsAsync(client, challengeId);

            using var verify = await client.PostAsJsonAsync(
                "/api/auth/mfa/passkey/verify", new { challengeId, response = answer(options) });

            Assert.True(HttpStatusCode.Unauthorized == verify.StatusCode, name);
            Assert.Null(await SignedInIdAsync(client));
            await using var scope = factory.OpenScope(out var db);
            // The proof was checked and failed, not refused before it.
            Assert.Equal(1, await db.AuthChallenges
                .Where(x => x.Id == Guid.Parse(challengeId)).Select(x => x.Attempts).SingleAsync());
        }

        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.Equal(refusals.Length, await db.SecurityEvents.CountAsync(
                x => x.UserId == account.Id && x.Kind == SecurityEventKinds.MfaFailed && x.Detail == "passkey"));
            Assert.Equal(sessionsBefore, await db.UserSessions.CountAsync(x => x.UserId == account.Id));
        }
    }

    [Fact]
    public async Task OneSignedPasskeyAnswerOpensOneSession()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var setup = Client(factory);
        await LoginAsync(setup, account.Username);
        using var key = new TestAuthenticator();
        await EnrollPasskeyAsync(setup, key);
        int sessionsBefore;
        await using (var scope = factory.OpenScope(out var db))
        {
            sessionsBefore = await db.UserSessions.CountAsync(x => x.UserId == account.Id);
        }

        using var client = Client(factory);
        var challenge = await LoginAsync(client, account.Username);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var options = await PasskeyOptionsAsync(client, challengeId);
        // A synced passkey may keep its count at zero; the kept options are
        // what stops a second use, not the counter.
        var answer = Sign(key, options, counter: 0);

        using var first = await client.PostAsJsonAsync(
            "/api/auth/mfa/passkey/verify", new { challengeId, response = answer });
        using var replay = await client.PostAsJsonAsync(
            "/api/auth/mfa/passkey/verify", new { challengeId, response = answer });

        first.EnsureSuccessStatusCode();
        Assert.NotEqual(HttpStatusCode.OK, replay.StatusCode);
        await using var check = factory.OpenScope(out var checkDb);
        Assert.Equal(sessionsBefore + 1, await checkDb.UserSessions.CountAsync(x => x.UserId == account.Id));
    }

    [Fact]
    public async Task RemovedPasskeyNoLongerCounts()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var setup = Client(factory);
        await LoginAsync(setup, account.Username);
        using var key = new TestAuthenticator();
        await EnrollPasskeyAsync(setup, key);
        // Another method keeps a second step due after the passkey is gone.
        await AddConfirmedTotpAsync(factory, account);
        Guid passkeyMethod;
        await using (var scope = factory.OpenScope(out var db))
        {
            passkeyMethod = await db.MfaMethods
                .Where(x => x.UserId == account.Id && x.Type == MfaMethodTypes.Passkey).Select(x => x.Id).SingleAsync();
        }

        using var remove = await setup.PostAsJsonAsync($"/api/me/security/mfa/{passkeyMethod}/remove", new { });
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);

        using var client = Client(factory);
        var challenge = await LoginAsync(client, account.Username);
        using var options = await client.PostAsJsonAsync(
            "/api/auth/mfa/passkey/options",
            new { challengeId = challenge.GetProperty("challengeId").GetString() });
        Assert.Equal(HttpStatusCode.Conflict, options.StatusCode);
    }

    [Fact]
    public async Task PasskeysAreNotOfferedWithoutASecurePublicAddress()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Operations:PublicUrl"] = "http://192.0.2.10:8080" });
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);

        var security = await client.GetFromJsonAsync<JsonElement>("/api/me/security");
        var challenge = await StartEnrollmentAsync(client);
        using var start = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/passkey/start",
            new { challengeId = challenge.GetProperty("challengeId").GetString() });

        Assert.False(security.GetProperty("passkeyAvailable").GetBoolean());
        Assert.False(challenge.GetProperty("passkeyAvailable").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, start.StatusCode);
    }

    /// <summary>Sets up a passkey on a signed-in client and returns the recovery codes it brought.</summary>
    private static async Task<string[]> EnrollPasskeyAsync(HttpClient client, TestAuthenticator key)
    {
        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        using var start = await client.PostAsJsonAsync("/api/auth/mfa/enroll/passkey/start", new { challengeId });
        start.EnsureSuccessStatusCode();
        var options = await start.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("required", options.GetProperty("authenticatorSelection").GetProperty("userVerification").GetString());

        var response = key.Register(
            options.GetProperty("rp").GetProperty("id").GetString()!,
            TestAuthenticator.FromBase64Url(options.GetProperty("challenge").GetString()!),
            PasskeyOrigin);
        using var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/passkey/confirm", new { challengeId, name = "Laptop", response });
        confirm.EnsureSuccessStatusCode();
        var completed = await confirm.Content.ReadFromJsonAsync<JsonElement>();
        return completed.TryGetProperty("recoveryCodes", out var codes) && codes.ValueKind == JsonValueKind.Array
            ? codes.EnumerateArray().Select(x => x.GetString()!).ToArray()
            : [];
    }

    private static async Task<JsonElement> PasskeyOptionsAsync(HttpClient client, string challengeId)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/mfa/passkey/options", new { challengeId });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static AuthenticatorAssertionRawResponse Sign(
        TestAuthenticator key,
        JsonElement options,
        uint counter = 1,
        AuthenticatorFlags flags = AuthenticatorFlags.UP | AuthenticatorFlags.UV,
        string origin = PasskeyOrigin,
        string? rpId = null) =>
        key.Assert(
            rpId ?? options.GetProperty("rpId").GetString()!,
            TestAuthenticator.FromBase64Url(options.GetProperty("challenge").GetString()!),
            origin,
            userHandle: null,
            counter,
            flags);

    /// <summary>The same signed answer, claiming to come from another credential.</summary>
    private static AuthenticatorAssertionRawResponse WithCredential(
        AuthenticatorAssertionRawResponse answer,
        byte[] credentialId) => new()
        {
            Id = TestAuthenticator.Base64Url(credentialId),
            RawId = credentialId,
            Type = answer.Type,
            ClientExtensionResults = answer.ClientExtensionResults,
            Response = answer.Response,
        };
}
