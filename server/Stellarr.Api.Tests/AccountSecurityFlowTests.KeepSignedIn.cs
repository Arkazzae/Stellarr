using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// "Keep me signed in": a sign-in that leaves it unticked gets a cookie the
/// browser drops when it closes and a session that ends after twelve hours,
/// and every later step that issues a cookie keeps that choice.
/// </summary>
public sealed partial class AccountSecurityFlowTests
{
    [Fact]
    public async Task SignInIsKeptUnlessItAsksNotToBe()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var kept = Client(factory);
        using var brief = Client(factory);

        using var keptLogin = await kept.PostAsJsonAsync(
            "/api/auth/login", new { username = account.Username, password = Password });
        using var briefLogin = await brief.PostAsJsonAsync(
            "/api/auth/login", new { username = account.Username, password = Password, keepSignedIn = false });

        Assert.True(OutlivesTheBrowser(keptLogin));
        Assert.False(OutlivesTheBrowser(briefLogin));
        Assert.Equal(account.Id.ToString(), await SignedInIdAsync(brief));

        await using var scope = factory.OpenScope(out var db);
        var sessions = await db.UserSessions.Where(x => x.UserId == account.Id)
            .OrderBy(x => x.ShortLived).ToListAsync();
        Assert.Equal([false, true], sessions.Select(x => x.ShortLived));
        AssertEndsIn(sessions[0].AbsoluteExpiresAt, SessionAuthentication.Lifetime);
        AssertEndsIn(sessions[1].AbsoluteExpiresAt, SessionAuthentication.ShortLifetime);
        AssertEndsIn(sessions[1].ExpiresAt, SessionAuthentication.ShortLifetime);
    }

    [Fact]
    public async Task ShortSessionIsNotStretchedByUseAndEndsOnTime()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        (await client.PostAsJsonAsync(
            "/api/auth/login", new { username = account.Username, password = Password, keepSignedIn = false }))
            .EnsureSuccessStatusCode();

        DateTime? hardEnd;
        await using (var scope = factory.OpenScope(out var db))
        {
            // Seen long enough ago that the next request renews the session.
            await db.UserSessions.Where(x => x.UserId == account.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.LastSeenAt, DateTime.UtcNow.AddHours(-1)));
            hardEnd = await db.UserSessions.Where(x => x.UserId == account.Id)
                .Select(x => x.AbsoluteExpiresAt).SingleAsync();
        }

        Assert.Equal(account.Id.ToString(), await SignedInIdAsync(client));
        await using (var scope = factory.OpenScope(out var db))
        {
            var renewed = await db.UserSessions.SingleAsync(x => x.UserId == account.Id);
            Assert.True(renewed.LastSeenAt > DateTime.UtcNow.AddMinutes(-1));
            Assert.True(renewed.ExpiresAt <= hardEnd);
            await db.UserSessions.Where(x => x.UserId == account.Id)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.AbsoluteExpiresAt, DateTime.UtcNow.AddMinutes(-1))
                    .SetProperty(x => x.LastSeenAt, DateTime.UtcNow.AddHours(-1)));
        }

        Assert.Null(await SignedInIdAsync(client));
    }

    [Fact]
    public async Task SecondStepFinishesTheSessionTheSignInAskedFor()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var setup = Client(factory);
        await LoginAsync(setup, account.Username);
        var enrolled = await EnrollTotpAsync(setup);

        using var brief = Client(factory);
        using var login = await brief.PostAsJsonAsync(
            "/api/auth/login", new { username = account.Username, password = Password, keepSignedIn = false });
        var challenge = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("mfa_required", challenge.GetProperty("status").GetString());

        using var verify = await brief.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                methodId = enrolled.MethodId.ToString(),
                code = TotpService.ComputeAt(enrolled.Secret, NextStepStart()),
            });

        verify.EnsureSuccessStatusCode();
        Assert.False(OutlivesTheBrowser(verify));
        await using var scope = factory.OpenScope(out var db);
        var newest = await db.UserSessions.Where(x => x.UserId == account.Id)
            .OrderByDescending(x => x.CreatedAt).FirstAsync();
        Assert.True(newest.ShortLived);
    }

    [Fact]
    public async Task ChangesMadeFromAShortSessionKeepItShort()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        (await client.PostAsJsonAsync(
            "/api/auth/login", new { username = account.Username, password = Password, keepSignedIn = false }))
            .EnsureSuccessStatusCode();

        // A first method: the setup starts from this session and ends in a new one.
        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var start = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start", new { challengeId, name = "Phone" });
        start.EnsureSuccessStatusCode();
        var draft = await start.Content.ReadFromJsonAsync<JsonElement>();
        var methodId = draft.GetProperty("methodId").GetString()!;
        using var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId,
                methodId,
                code = TotpService.ComputeAt(draft.GetProperty("secret").GetString()!, DateTime.UtcNow),
                name = "Phone",
            });
        confirm.EnsureSuccessStatusCode();
        Assert.False(OutlivesTheBrowser(confirm));

        // Removing it re-issues the cookie of the same session.
        using var remove = await client.PostAsJsonAsync($"/api/me/security/mfa/{methodId}/remove", new { });
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        Assert.False(OutlivesTheBrowser(remove));

        // So does a password change.
        using var password = await client.PostAsJsonAsync(
            "/api/me/password", new { currentPassword = Password, newPassword = "Another!Password2026" });
        password.EnsureSuccessStatusCode();
        Assert.False(OutlivesTheBrowser(password));

        await using var scope = factory.OpenScope(out var db);
        var active = await db.UserSessions
            .Where(x => x.UserId == account.Id && x.RevokedAt == null).ToListAsync();
        var current = Assert.Single(active);
        Assert.True(current.ShortLived);
        Assert.True(current.ExpiresAt <= current.AbsoluteExpiresAt);
        AssertEndsIn(current.AbsoluteExpiresAt, SessionAuthentication.ShortLifetime);
    }

    [Fact]
    public async Task OperatorRecoveryCarriesTheChoiceIntoTheNewMethod()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        const string token = "recovery-credential-for-keep-signed-in";
        await using (var scope = factory.OpenScope(out var db))
        {
            var user = await db.Users.SingleAsync(x => x.Id == account.Id);
            user.SecurityRecoveryRequired = true;
            db.CliRecoveryCredentials.Add(new CliRecoveryCredential
            {
                Id = Guid.NewGuid(),
                UserId = account.Id,
                TokenHash = SecurityTokens.Hash(token),
                Reason = "lost phone",
                SecurityVersion = user.SessionVersion,
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddMinutes(10),
            });
            await db.SaveChangesAsync();
        }

        using var client = Client(factory);
        var redeem = await client.PostAsJsonAsync(
            "/api/auth/recovery/redeem", new { credential = token, keepSignedIn = false });
        redeem.EnsureSuccessStatusCode();
        var challenge = await redeem.Content.ReadFromJsonAsync<JsonElement>();
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var start = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start", new { challengeId, name = "Phone" });
        start.EnsureSuccessStatusCode();
        var draft = await start.Content.ReadFromJsonAsync<JsonElement>();
        using var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId,
                methodId = draft.GetProperty("methodId").GetString(),
                code = TotpService.ComputeAt(draft.GetProperty("secret").GetString()!, DateTime.UtcNow),
                name = "Phone",
            });

        confirm.EnsureSuccessStatusCode();
        Assert.False(OutlivesTheBrowser(confirm));
    }

    /// <summary>Whether the session cookie this response sets has an expiry, which makes the browser keep it.</summary>
    private static bool OutlivesTheBrowser(HttpResponseMessage response)
    {
        var cookie = Assert.Single(
            response.Headers.GetValues("Set-Cookie"),
            header => header.Split('=', 2)[0].EndsWith("-session", StringComparison.Ordinal));
        return cookie.Contains("expires=", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string?> SignedInIdAsync(HttpClient client)
    {
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        var user = session.GetProperty("user");
        return user.ValueKind == JsonValueKind.Null ? null : user.GetProperty("id").GetString();
    }

    private static void AssertEndsIn(DateTime? end, TimeSpan lifetime)
    {
        Assert.NotNull(end);
        var expected = DateTime.UtcNow.Add(lifetime);
        Assert.InRange(end.Value, expected.AddMinutes(-2), expected.AddMinutes(1));
    }
}
