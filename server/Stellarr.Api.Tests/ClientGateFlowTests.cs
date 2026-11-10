using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

/// <summary>
/// The door: which builds this instance will let sign in.
/// </summary>
public sealed class ClientGateFlowTests
{
    [Fact]
    public async Task ClientThatDoesNotIdentifyItselfCannotSignIn()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Anonymous(factory);

        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("unsupported-client", problem.GetProperty("code").GetString());
        // `GetValues` throws when the header is absent, which is the very
        // outcome this asserts — so the old spelling could only pass if the
        // refusal *had* set a cookie. `TryGetValues` states the intent and
        // still fails loudly if one ever appears.
        Assert.False(response.Headers.TryGetValues("Set-Cookie", out _));
    }

    [Fact]
    public async Task ClientFromAnotherProductCannotSignIn()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Anonymous(factory);
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client", "voicephy");
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client-Version", "9.9.9");

        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task DesktopBuildBelowTheMinimumIsRefusedAndToldTheFloor()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Desktop:MinimumVersion"] = "0.1.3",
            });
        using var client = Anonymous(factory);
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "X-Stellarr-Client",
            "desktop-linux");
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "X-Stellarr-Client-Version",
            "0.1.1");

        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("outdated-client", problem.GetProperty("code").GetString());
        Assert.Equal("0.1.3", problem.GetProperty("minimumVersion").GetString());
    }

    [Fact]
    public async Task CurrentDesktopBuildSignsInAndReadsItsSession()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Desktop:MinimumVersion"] = "0.1.3",
            });
        using var client = Anonymous(factory);
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "X-Stellarr-Client",
            "desktop-linux");
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "X-Stellarr-Client-Version",
            "0.1.3");

        (await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();

        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(
            "maja",
            session.GetProperty("user").GetProperty("username").GetString());
    }

    /// <summary>
    /// A session already granted to an unsupported build stops working: the
    /// point is to end it, not only to refuse the next sign-in.
    /// </summary>
    [Fact]
    public async Task SessionOfAnUnsupportedBuildIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

        (await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();

        client.DefaultRequestHeaders.Remove("X-Stellarr-Client");
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client-Version");

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await client.GetAsync("/api/session")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await client.GetAsync("/api/bootstrap")).StatusCode);
    }

    /// <summary>An instance that wants to be reachable by script can say so.</summary>
    [Fact]
    public async Task IdentificationCanBeTurnedOffForAnInstance()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Clients:RequireIdentification"] = "false",
            });
        using var client = Anonymous(factory);

        (await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
    }

    /// <summary>
    /// The factory identifies every client it hands out as the browser build;
    /// these tests are about what happens to everything else.
    /// </summary>
    private static HttpClient Anonymous(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client");
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client-Version");
        return client;
    }
}
