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
        Assert.Contains("Możesz zamknąć tę kartę", await approval.Content.ReadAsStringAsync());

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
}
