using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>Signing in with a passkey and no password.</summary>
public sealed partial class AccountSecurityFlowTests
{
    [Fact]
    public async Task PasskeyAloneSignsInWithASecondStepPassed()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var key = await AccountWithPasskeyAsync(factory, account);

        using var client = Client(factory);
        var status = await client.GetFromJsonAsync<JsonElement>("/api/auth/passkey");
        Assert.True(status.GetProperty("available").GetBoolean());
        var options = await SignInOptionsAsync(client);
        Assert.Equal(0, options.GetProperty("allowCredentials").GetArrayLength());
        Assert.Equal("required", options.GetProperty("userVerification").GetString());

        using var login = await client.PostAsJsonAsync(
            "/api/auth/passkey/login",
            new { response = SignIn(key, options, account.Id.ToByteArray()), keepSignedIn = false });

        login.EnsureSuccessStatusCode();
        Assert.False(OutlivesTheBrowser(login));
        Assert.Equal(account.Id.ToString(), await SignedInIdAsync(client));
        await using var scope = factory.OpenScope(out var db);
        var session = await db.UserSessions
            .Where(x => x.UserId == account.Id).OrderByDescending(x => x.CreatedAt).FirstAsync();
        Assert.Equal(MfaMethodTypes.Passkey, session.PrimarySource);
        Assert.Equal(MfaMethodTypes.Passkey, session.MfaEvidence);
        Assert.NotNull(session.MfaCompletedAt);
        Assert.True(session.ShortLived);
    }

    [Fact]
    public async Task PasskeySignInIsRefusedWithoutTheAccountsOwnHandleOrCeremony()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        var other = await CreateAccountAsync(factory);
        using var key = await AccountWithPasskeyAsync(factory, account);

        var refusals = new (string Case, Func<HttpClient, Task<HttpResponseMessage>> Attempt)[]
        {
            ("no user handle", async client => await client.PostAsJsonAsync(
                "/api/auth/passkey/login",
                new { response = SignIn(key, await SignInOptionsAsync(client), userHandle: null) })),
            ("another account's handle", async client => await client.PostAsJsonAsync(
                "/api/auth/passkey/login",
                new { response = SignIn(key, await SignInOptionsAsync(client), other.Id.ToByteArray()) })),
            ("options from another browser", async client =>
            {
                using var elsewhere = Client(factory);
                var options = await SignInOptionsAsync(elsewhere);
                return await client.PostAsJsonAsync(
                    "/api/auth/passkey/login",
                    new { response = SignIn(key, options, account.Id.ToByteArray()) });
            }),
        };
        foreach (var (name, attempt) in refusals)
        {
            using var client = Client(factory);
            using var response = await attempt(client);
            Assert.True(HttpStatusCode.Unauthorized == response.StatusCode, name);
            Assert.Null(await SignedInIdAsync(client));
        }

        // The control: the same key, with its own handle and options, works.
        using var control = Client(factory);
        using var accepted = await control.PostAsJsonAsync(
            "/api/auth/passkey/login",
            new { response = SignIn(key, await SignInOptionsAsync(control), account.Id.ToByteArray()) });
        accepted.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task OnePasskeySignInAnswerOpensOneSession()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var key = await AccountWithPasskeyAsync(factory, account);
        int sessionsBefore;
        await using (var scope = factory.OpenScope(out var db))
        {
            sessionsBefore = await db.UserSessions.CountAsync(x => x.UserId == account.Id);
        }

        using var client = Client(factory);
        var options = await SignInOptionsAsync(client);
        var answer = SignIn(key, options, account.Id.ToByteArray());

        using var first = await client.PostAsJsonAsync("/api/auth/passkey/login", new { response = answer });
        using var replay = await client.PostAsJsonAsync("/api/auth/passkey/login", new { response = answer });

        first.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        await using var check = factory.OpenScope(out var checkDb);
        Assert.Equal(sessionsBefore + 1, await checkDb.UserSessions.CountAsync(x => x.UserId == account.Id));
    }

    [Fact]
    public async Task PasskeyStopsSigningInAfterAnOperatorsRecoveryOrADisabledAccount()
    {
        using var factory = new StellarrWebApplicationFactory();
        var recovered = await CreateAccountAsync(factory);
        var disabled = await CreateAccountAsync(factory);
        using var recoveredKey = await AccountWithPasskeyAsync(factory, recovered);
        using var disabledKey = await AccountWithPasskeyAsync(factory, disabled);
        await using (var scope = factory.OpenScope(out var db))
        {
            // What `security recover` does: every method ends and only the recovery opens the account.
            var now = DateTime.UtcNow;
            await db.MfaMethods.Where(x => x.UserId == recovered.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now));
            await db.Users.Where(x => x.Id == recovered.Id)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.SecurityRecoveryRequired, true)
                    .SetProperty(x => x.SessionVersion, x => x.SessionVersion + 1));
            await db.Users.Where(x => x.Id == disabled.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.IsDisabled, true));
        }

        foreach (var (account, key) in new[] { (recovered, recoveredKey), (disabled, disabledKey) })
        {
            using var client = Client(factory);
            using var login = await client.PostAsJsonAsync(
                "/api/auth/passkey/login",
                new { response = SignIn(key, await SignInOptionsAsync(client), account.Id.ToByteArray()) });
            Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
            Assert.Null(await SignedInIdAsync(client));
        }
    }

    /// <summary>An account with a passkey set up, signed out again.</summary>
    private static async Task<TestAuthenticator> AccountWithPasskeyAsync(
        StellarrWebApplicationFactory factory,
        User account)
    {
        using var setup = Client(factory);
        await LoginAsync(setup, account.Username);
        var key = new TestAuthenticator();
        await EnrollPasskeyAsync(setup, key);
        return key;
    }

    private static async Task<JsonElement> SignInOptionsAsync(HttpClient client)
    {
        using var response = await client.PostAsync("/api/auth/passkey/options", null);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static Fido2NetLib.AuthenticatorAssertionRawResponse SignIn(
        TestAuthenticator key,
        JsonElement options,
        byte[]? userHandle) =>
        key.Assert(
            options.GetProperty("rpId").GetString()!,
            TestAuthenticator.FromBase64Url(options.GetProperty("challenge").GetString()!),
            PasskeyOrigin,
            userHandle,
            counter: 0);
}
