using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class SignInFlowTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private const string Password = "Passw0rd!2026";
    private const string WrongCredentials = "Nieprawidłowy login lub hasło.";

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task WrongPasswordAndUnknownAccountAreTurnedAwayAlike(bool accountExists)
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();

        using var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = accountExists ? account.Username : "nobody-here", password = "not-the-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WrongCredentials, problem.GetProperty("title").GetString());
        Assert.False(response.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task LoginAcceptsUsernameOrEmailInAnyLetterCase()
    {
        var account = await CreateAccountAsync(email: $"{DataModelSupport.UniqueName()}@Example.test");
        using var client = NewClient();

        foreach (var identifier in new[]
        {
            account.Username,
            account.Username.ToUpperInvariant(),
            account.Email!,
            account.Email!.ToLowerInvariant(),
            $"  {account.Email.ToUpperInvariant()} ",
        })
        {
            using var response = await client.PostAsJsonAsync(
                "/api/auth/login",
                new { username = identifier, password = Password });

            response.EnsureSuccessStatusCode();
            var user = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(account.Username, user.GetProperty("username").GetString());
            Assert.Equal("online", user.GetProperty("presence").GetString());
        }
    }

    [Fact]
    public async Task DisabledAccountCannotSignIn()
    {
        var account = await CreateAccountAsync(disabled: true);
        using var client = NewClient();

        using var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = account.Username, password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task SignInRecordsTheDeviceItCameFrom()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("StellarrTest/1.0");

        await SignInAsync(client, account.Username);

        var session = await SingleSessionAsync(account.Id);
        Assert.Equal("StellarrTest/1.0", session.Device);
        Assert.NotEmpty(session.IpAddress);
        Assert.Null(session.RevokedAt);
        Assert.True(session.ExpiresAt > DateTime.UtcNow.AddDays(29));
    }

    [Fact]
    public async Task SessionEndpointAnswersAnonymousCallersWithoutAUser()
    {
        using var client = NewClient();

        using var response = await client.GetAsync("/api/session");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task SessionEndpointNamesTheSignedInAccount()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);

        var user = await SessionUserAsync(client, cookie);

        Assert.Equal(account.Id.ToString(), user.GetProperty("id").GetString());
        Assert.Equal(account.Username, user.GetProperty("username").GetString());
        Assert.Equal("offline", user.GetProperty("presence").GetString());
    }

    [Fact]
    public async Task LogoutRevokesTheSessionSoItsCookieStopsWorking()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);
        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, cookie)).ValueKind);

        using var logout = await SendAsync(client, HttpMethod.Post, "/api/auth/logout", cookie);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.NotNull((await SingleSessionAsync(account.Id)).RevokedAt);
        Assert.Equal(JsonValueKind.Null, (await SessionUserAsync(client, cookie)).ValueKind);
    }

    [Fact]
    public async Task LogoutNeedsASignedInCaller()
    {
        using var client = NewClient();

        using var response = await client.PostAsync("/api/auth/logout", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("revoked")]
    [InlineData("expired")]
    [InlineData("disabled")]
    [InlineData("version-bumped")]
    [InlineData("session-deleted")]
    public async Task CookieIsRefusedOnceItsSessionOrAccountNoLongerAllowsIt(string change)
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);
        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, cookie)).ValueKind);

        await using (var scope = factory.OpenScope(out var db))
        {
            var now = DateTime.UtcNow;
            switch (change)
            {
                case "revoked":
                    await db.UserSessions.Where(x => x.UserId == account.Id)
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now));
                    break;
                case "expired":
                    await db.UserSessions.Where(x => x.UserId == account.Id)
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, now.AddMinutes(-1)));
                    break;
                case "disabled":
                    await db.Users.Where(x => x.Id == account.Id)
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDisabled, true));
                    break;
                case "version-bumped":
                    await db.Users.Where(x => x.Id == account.Id)
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.SessionVersion, x => x.SessionVersion + 1));
                    break;
                default:
                    await db.UserSessions.Where(x => x.UserId == account.Id).ExecuteDeleteAsync();
                    break;
            }
        }

        Assert.Equal(JsonValueKind.Null, (await SessionUserAsync(client, cookie)).ValueKind);
        using var logout = await SendAsync(client, HttpMethod.Post, "/api/auth/logout", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, logout.StatusCode);
    }

    [Fact]
    public async Task OtherSessionsOfTheSameAccountSurviveALogout()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var first = await SignInAsync(client, account.Username);
        var second = await SignInAsync(client, account.Username);

        using var logout = await SendAsync(client, HttpMethod.Post, "/api/auth/logout", first);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await SessionUserAsync(client, first)).ValueKind);
        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, second)).ValueKind);
    }

    [Fact]
    public async Task SessionSeenLongAgoIsMarkedSeenAndRenewedWhenItsEndIsNear()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);
        var stale = DateTime.UtcNow.AddMinutes(-30);
        await SetSessionTimesAsync(account.Id, lastSeenAt: stale, expiresAt: DateTime.UtcNow.AddDays(3));

        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, cookie)).ValueKind);

        var session = await SingleSessionAsync(account.Id);
        Assert.True(session.LastSeenAt > DateTime.UtcNow.AddMinutes(-1));
        Assert.True(session.ExpiresAt > DateTime.UtcNow.AddDays(29));
    }

    [Fact]
    public async Task SessionSeenRecentlyIsLeftAlone()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);
        var seen = DateTime.UtcNow.AddMinutes(-2);
        var expires = DateTime.UtcNow.AddDays(3);
        await SetSessionTimesAsync(account.Id, seen, expires);

        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, cookie)).ValueKind);

        var session = await SingleSessionAsync(account.Id);
        Assert.Equal(seen, session.LastSeenAt, TimeSpan.FromSeconds(1));
        Assert.Equal(expires, session.ExpiresAt, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task SessionWithMoreThanHalfItsLifeLeftKeepsItsExpiry()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);
        var expires = DateTime.UtcNow.AddDays(20);
        await SetSessionTimesAsync(account.Id, DateTime.UtcNow.AddMinutes(-30), expires);

        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, cookie)).ValueKind);

        var session = await SingleSessionAsync(account.Id);
        Assert.True(session.LastSeenAt > DateTime.UtcNow.AddMinutes(-1));
        Assert.Equal(expires, session.ExpiresAt, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task LegacySlidingSessionOlderThanThirtyDaysUsesItsAbsoluteExpiry()
    {
        var account = await CreateAccountAsync();
        using var client = NewClient();
        var cookie = await SignInAsync(client, account.Username);
        await using (var scope = factory.OpenScope(out var db))
        {
            var now = DateTime.UtcNow;
            await db.UserSessions.Where(x => x.UserId == account.Id).ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.CreatedAt, now.AddDays(-40))
                .SetProperty(x => x.LastSeenAt, now)
                .SetProperty(x => x.ExpiresAt, now.AddDays(5))
                .SetProperty(x => x.AbsoluteExpiresAt, now.AddDays(5)));
        }

        Assert.Equal(JsonValueKind.Object, (await SessionUserAsync(client, cookie)).ValueKind);
    }

    [Fact]
    public async Task PasswordAttemptsAreLimitedPerAddress()
    {
        // The limits are lifted in the Testing environment, so this host runs
        // as development, where they come from configuration.
        using var limited = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("RateLimiting:Login:PermitLimit", "2");
        });
        using var client = limited.CreateClient();
        var attempt = new { username = "nobody-here", password = "not-the-password" };

        using var first = await client.PostAsJsonAsync("/api/auth/login", attempt);
        using var second = await client.PostAsJsonAsync("/api/auth/login", attempt);
        using var third = await client.PostAsJsonAsync("/api/auth/login", attempt);

        Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, second.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
    }

    [Fact]
    public async Task VolumeFromBeforeSessionsAndEmailLoginGainsThemOnUpgrade()
    {
        var path = Path.Combine(Path.GetTempPath(), $"stellarr-auth-upgrade-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={path}").Options;
        var userId = Guid.NewGuid();

        try
        {
            await using (var old = new AppDbContext(options))
            {
                await old.Database.EnsureCreatedAsync();
                old.Users.Add(NewUser(userId, "veteran"));
                await old.SaveChangesAsync();

                // The Users table and its neighbours as the first release wrote them.
                await old.Database.ExecuteSqlRawAsync(
                    """
                    DROP INDEX "IX_Users_NormalizedEmail";
                    ALTER TABLE "Users" DROP COLUMN "Email";
                    ALTER TABLE "Users" DROP COLUMN "NormalizedEmail";
                    ALTER TABLE "Users" DROP COLUMN "IsDisabled";
                    ALTER TABLE "Users" DROP COLUMN "SessionVersion";
                    DROP TABLE "PasswordResetTokens";
                    DROP TABLE "UserSessions";
                    DROP TABLE "DesktopBrowserLogins";
                    DROP TABLE "ExternalIdentities";
                    """);
            }

            await using var upgraded = new AppDbContext(options);
            await DatabaseSchema.UpgradeAsync(upgraded, CancellationToken.None);
            // Every start runs the steps again.
            await DatabaseSchema.UpgradeAsync(upgraded, CancellationToken.None);

            var user = await upgraded.Users.SingleAsync(x => x.Id == userId);
            Assert.Equal(0, user.SessionVersion);
            Assert.False(user.IsDisabled);
            Assert.Null(user.Email);

            var now = DateTime.UtcNow;
            upgraded.UserSessions.Add(new UserSession
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Device = "device",
                IpAddress = "127.0.0.1",
                CreatedAt = now,
                LastSeenAt = now,
                ExpiresAt = now.AddDays(1),
            });
            upgraded.DesktopBrowserLogins.Add(new DesktopBrowserLogin
            {
                Id = Guid.NewGuid(),
                SecretHash = DataModelSupport.Hash(),
                CreatedAt = now,
                ExpiresAt = now.AddMinutes(2),
            });
            upgraded.ExternalIdentities.Add(new ExternalIdentity
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Issuer = "https://identity.test",
                Subject = "subject",
                CreatedAt = now,
            });
            upgraded.PasswordResetTokens.Add(new PasswordResetToken
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                TokenHash = DataModelSupport.Hash(),
                CreatedAt = now,
                ExpiresAt = now.AddHours(1),
            });
            await upgraded.SaveChangesAsync();

            // An address still belongs to one account.
            var first = NewUser(Guid.NewGuid(), "first");
            var second = NewUser(Guid.NewGuid(), "second");
            first.NormalizedEmail = second.NormalizedEmail = "SHARED@EXAMPLE.TEST";
            upgraded.Users.AddRange(first, second);
            await Assert.ThrowsAsync<DbUpdateException>(() => upgraded.SaveChangesAsync());
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(path);
        }
    }

    /// <summary>
    /// A client that keeps no cookies of its own, so each test decides which
    /// sign-in a request speaks for.
    /// </summary>
    private HttpClient NewClient() => factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = false,
    });

    private async Task<User> CreateAccountAsync(string? email = null, bool disabled = false)
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<PasswordService>().Hash(Password);
        user.Email = email;
        user.NormalizedEmail = email?.ToUpperInvariant();
        user.IsDisabled = disabled;
        await db.SaveChangesAsync();
        return user;
    }

    private static User NewUser(Guid id, string username) => new()
    {
        Id = id,
        Username = username,
        NormalizedUsername = username.ToUpperInvariant(),
        DisplayName = username,
        PasswordHash = "hash",
        AvatarColor = "#777777",
        CreatedAt = DateTime.UtcNow,
    };

    /// <summary>Signs in and returns the cookies the server set, as a Cookie header.</summary>
    private static async Task<string> SignInAsync(HttpClient client, string identifier)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = identifier, password = Password });
        response.EnsureSuccessStatusCode();
        return string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        string cookie)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("Cookie", cookie);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> SessionUserAsync(HttpClient client, string cookie)
    {
        using var response = await SendAsync(client, HttpMethod.Get, "/api/session", cookie);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("user");
    }

    private async Task<UserSession> SingleSessionAsync(Guid userId)
    {
        await using var scope = factory.OpenScope(out var db);
        return await db.UserSessions.AsNoTracking().SingleAsync(x => x.UserId == userId);
    }

    private async Task SetSessionTimesAsync(Guid userId, DateTime lastSeenAt, DateTime expiresAt)
    {
        await using var scope = factory.OpenScope(out var db);
        await db.UserSessions.Where(x => x.UserId == userId).ExecuteUpdateAsync(setters => setters
            .SetProperty(x => x.LastSeenAt, lastSeenAt)
            .SetProperty(x => x.ExpiresAt, expiresAt));
    }
}
