using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class DesktopBrowserLoginFlowTests
{
    [Fact]
    public async Task AuthenticatedBrowserCanApproveOneTimeDesktopSession()
    {
        using var factory = Factory();
        using var desktop = DesktopClient(factory);

        var start = await desktop.PostAsync("/api/auth/desktop/browser/start", null);
        start.EnsureSuccessStatusCode();
        var handle = await start.Content.ReadFromJsonAsync<JsonElement>();
        var requestId = handle.GetProperty("requestId").GetString()!;
        var secret = handle.GetProperty("secret").GetString()!;

        var pending = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId, secret });
        Assert.Equal(HttpStatusCode.Accepted, pending.StatusCode);

        using var browser = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await browser.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();

        var approval = await browser.GetAsync($"/api/auth/desktop/browser/verify/{requestId}");
        approval.EnsureSuccessStatusCode();
        Assert.Equal("no-store", approval.Headers.CacheControl?.ToString());
        Assert.Contains("Zatwierdzić to logowanie", await approval.Content.ReadAsStringAsync());

        var token = ApprovalToken(await approval.Content.ReadAsStringAsync());
        var stillPending = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId, secret });
        Assert.Equal(HttpStatusCode.Accepted, stillPending.StatusCode);

        using var confirmed = await browser.PostAsync(
            $"/api/auth/desktop/browser/verify/{requestId}",
            new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)]));
        confirmed.EnsureSuccessStatusCode();
        Assert.Contains("Możesz zamknąć tę kartę", await confirmed.Content.ReadAsStringAsync());

        var exchange = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId, secret });
        exchange.EnsureSuccessStatusCode();
        Assert.Equal(
            "maja",
            (await exchange.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("username").GetString());

        var session = await desktop.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(
            "maja",
            session.GetProperty("user").GetProperty("username").GetString());

        var replay = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId, secret });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
    }

    [Fact]
    public async Task DesktopBrowserSecretIsHashedAndWrongSecretIsRejected()
    {
        using var factory = Factory();
        using var desktop = DesktopClient(factory);

        var start = await desktop.PostAsync("/api/auth/desktop/browser/start", null);
        start.EnsureSuccessStatusCode();
        var handle = await start.Content.ReadFromJsonAsync<JsonElement>();
        var requestId = handle.GetProperty("requestId").GetString()!;
        var secret = handle.GetProperty("secret").GetString()!;

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = await db.DesktopBrowserLogins.SingleAsync(
                x => x.Id == Guid.Parse(requestId));
            Assert.NotEqual(secret, stored.SecretHash);
            Assert.Equal(64, stored.SecretHash.Length);
        }

        var rejected = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId, secret = new string('x', 43) });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }

    private static HttpClient DesktopClient(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client");
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client-Version");
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client", "desktop-linux");
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client-Version", "0.1.3");
        return client;
    }

    /// <summary>
    /// The desktop waits for its approval by polling, once every 1.5 seconds. On the
    /// same fixed window as password login that spent the whole per-address budget in
    /// about thirteen seconds, so the login failed at the moment the browser approved
    /// it and the address could not log in by password either until the window rolled.
    /// The two therefore have to be counted apart.
    /// </summary>
    [Fact]
    public void PollingForBrowserApprovalIsNotCountedAgainstPasswordLogin()
    {
        using var factory = Factory();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints;

        var login = PolicyOf(endpoints, "/api/auth/login");
        var poll = PolicyOf(endpoints, "/api/auth/desktop/browser/exchange");

        Assert.Equal("login", login);
        Assert.NotNull(poll);
        Assert.NotEqual(login, poll);
    }

    private static string? PolicyOf(IReadOnlyList<Endpoint> endpoints, string route) => endpoints
        .OfType<RouteEndpoint>()
        .Where(endpoint => endpoint.RoutePattern.RawText == route)
        .Select(endpoint => endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName)
        .FirstOrDefault(policy => policy is not null);

    [Fact]
    public async Task ApprovalTokenIsBoundToTheExactApprovingAccountAndSession()
    {
        using var factory = Factory();
        using var desktop = DesktopClient(factory);
        var requestId = await StartAsync(desktop);

        using var first = Browser(factory, "maja", "Aurora!2026");
        using var page = await first.GetAsync($"/api/auth/desktop/browser/verify/{requestId}");
        page.EnsureSuccessStatusCode();
        var token = ApprovalToken(await page.Content.ReadAsStringAsync());

        using var second = Browser(factory, "ada", "Quasar!2026");
        using var stolen = await second.PostAsync(
            $"/api/auth/desktop/browser/verify/{requestId}",
            new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)]));
        Assert.NotEqual(HttpStatusCode.OK, stolen.StatusCode);
    }

    [Fact]
    public async Task SiblingOriginApprovalPostIsRefused()
    {
        using var factory = Factory();
        using var desktop = DesktopClient(factory);
        var requestId = await StartAsync(desktop);
        using var browser = Browser(factory, "maja", "Aurora!2026");
        using var page = await browser.GetAsync($"/api/auth/desktop/browser/verify/{requestId}");
        var token = ApprovalToken(await page.Content.ReadAsStringAsync());

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/auth/desktop/browser/verify/{requestId}")
        {
            Content = new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)]),
        };
        request.Headers.Add("Origin", "https://localhost:4443");
        using var refused = await browser.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
    }

    [Theory]
    [InlineData("absolute")]
    [InlineData("expired")]
    [InlineData("revoked")]
    [InlineData("version")]
    [InlineData("recovery")]
    public async Task ExchangeRejectsAChangedSourceSession(string change)
    {
        using var factory = Factory();
        using var desktop = DesktopClient(factory);
        var handle = await StartHandleAsync(desktop);
        var requestId = handle.RequestId;
        using var browser = Browser(factory, "maja", "Aurora!2026");
        using var page = await browser.GetAsync($"/api/auth/desktop/browser/verify/{requestId}");
        var token = ApprovalToken(await page.Content.ReadAsStringAsync());
        using var approved = await browser.PostAsync(
            $"/api/auth/desktop/browser/verify/{requestId}",
            new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)]));
        approved.EnsureSuccessStatusCode();

        await using (var scope = factory.OpenScope(out var db))
        {
            var session = await db.UserSessions.OrderByDescending(x => x.CreatedAt).FirstAsync();
            switch (change)
            {
                case "absolute":
                    session.AbsoluteExpiresAt = DateTime.UtcNow.AddMinutes(-1);
                    break;
                case "expired":
                    session.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
                    break;
                case "revoked":
                    session.RevokedAt = DateTime.UtcNow;
                    break;
                case "recovery":
                    await db.Users.Where(x => x.Id == session.UserId).ExecuteUpdateAsync(
                        setters => setters.SetProperty(x => x.SecurityRecoveryRequired, true));
                    break;
                default:
                    await db.Users.Where(x => x.Id == session.UserId).ExecuteUpdateAsync(
                        setters => setters.SetProperty(x => x.SessionVersion, x => x.SessionVersion + 1));
                    break;
            }

            await db.SaveChangesAsync();
        }

        using var exchange = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId = handle.RequestId, secret = handle.Secret });
        Assert.Equal(HttpStatusCode.Forbidden, exchange.StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await desktop.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task TwoConcurrentExchangesForOneApprovalCreateOneDesktopSession()
    {
        using var factory = Factory();
        using var desktop = DesktopClient(factory);
        var handle = await StartHandleAsync(desktop);
        using var browser = Browser(factory, "maja", "Aurora!2026");
        using var page = await browser.GetAsync($"/api/auth/desktop/browser/verify/{handle.RequestId}");
        var token = ApprovalToken(await page.Content.ReadAsStringAsync());
        using var approved = await browser.PostAsync(
            $"/api/auth/desktop/browser/verify/{handle.RequestId}",
            new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)]));
        approved.EnsureSuccessStatusCode();

        var responses = await Task.WhenAll(
            desktop.PostAsJsonAsync(
                "/api/auth/desktop/browser/exchange",
                new { requestId = handle.RequestId, secret = handle.Secret }),
            desktop.PostAsJsonAsync(
                "/api/auth/desktop/browser/exchange",
                new { requestId = handle.RequestId, secret = handle.Secret }));

        Assert.Single(responses, response => response.IsSuccessStatusCode);
        await using var scope = factory.OpenScope(out var db);
        var userId = Guid.Parse("30000000-0000-0000-0000-000000000001");
        Assert.Equal(
            2,
            await db.UserSessions.CountAsync(x => x.UserId == userId && x.RevokedAt == null));
    }

    private static HttpClient Browser(StellarrWebApplicationFactory factory, string username, string password)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password })).GetAwaiter().GetResult().EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<Guid> StartAsync(HttpClient desktop)
    {
        var handle = await StartHandleAsync(desktop);
        return handle.RequestId;
    }

    private static async Task<(Guid RequestId, string Secret)> StartHandleAsync(HttpClient desktop)
    {
        using var start = await desktop.PostAsync("/api/auth/desktop/browser/start", null);
        start.EnsureSuccessStatusCode();
        var handle = await start.Content.ReadFromJsonAsync<JsonElement>();
        return (
            Guid.Parse(handle.GetProperty("requestId").GetString()!),
            handle.GetProperty("secret").GetString()!);
    }

    private static StellarrWebApplicationFactory Factory() => new(
        loadTestData: true,
        configureServices: services =>
        {
            services.RemoveAll<ExternalOidcOptions>();
            services.AddSingleton(new ExternalOidcOptions
            {
                Enabled = true,
                Authority = "https://identity.test",
                ClientId = "stellarr-tests",
                ClientSecret = "test-client-secret",
            });
        });

    internal static string ApprovalToken(string html)
    {
        var marker = "name=\"token\" value=\"";
        var start = html.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, "The approval page has no CSRF token.");
        start += marker.Length;
        var end = html.IndexOf('"', start);
        Assert.True(end > start, "The approval page has a broken CSRF token.");
        return html[start..end];
    }
}
