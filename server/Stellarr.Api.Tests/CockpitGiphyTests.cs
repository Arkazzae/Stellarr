using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Integrations;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Tests;

public sealed class CockpitGiphyTests
{
    [Fact]
    public async Task AnInstanceThatNeverChoseKeepsGifsOnWhileItHasAKey()
    {
        using var factory = Factory("env-key");
        using var owner = await OwnerAsync(factory);

        var config = await JsonAsync(await owner.GetAsync("/api/config/giphy"));
        var settings = await JsonAsync(await owner.GetAsync("/api/cockpit/settings"));

        Assert.True(config.GetProperty("enabled").GetBoolean());
        Assert.Equal("env-key", config.GetProperty("apiKey").GetString());
        Assert.True(settings.GetProperty("giphyEnabled").GetBoolean());
        Assert.True(settings.GetProperty("giphyKeyConfigured").GetBoolean());
    }

    [Fact]
    public async Task TurningGifsOffHandsOutNoKeyAndOnAgainBringsItBack()
    {
        using var factory = Factory("env-key");
        using var owner = await OwnerAsync(factory);
        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");

        var off = await SaveGiphyAsync(owner, enabled: false);
        var offConfig = await JsonAsync(await member.GetAsync("/api/config/giphy"));
        Assert.False(off.GetProperty("giphyEnabled").GetBoolean());
        Assert.False(offConfig.GetProperty("enabled").GetBoolean());
        Assert.Equal("", offConfig.GetProperty("apiKey").GetString());

        await SaveGiphyAsync(owner, enabled: true);
        var onConfig = await JsonAsync(await member.GetAsync("/api/config/giphy"));
        Assert.True(onConfig.GetProperty("enabled").GetBoolean());
        Assert.Equal("env-key", onConfig.GetProperty("apiKey").GetString());
    }

    [Fact]
    public async Task WithoutAKeyGifsStayOffWhateverTheSwitch()
    {
        using var factory = Factory("");
        using var owner = await OwnerAsync(factory);

        var saved = await SaveGiphyAsync(owner, enabled: true);
        var config = await JsonAsync(await owner.GetAsync("/api/config/giphy"));

        Assert.False(saved.GetProperty("giphyEnabled").GetBoolean());
        Assert.False(saved.GetProperty("giphyKeyConfigured").GetBoolean());
        Assert.False(config.GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task TheConnectionCheckReportsAWorkingKey()
    {
        var giphy = new StubGiphy(HttpStatusCode.OK);
        using var factory = Factory("env-key", giphy);
        using var owner = await OwnerAsync(factory);

        var result = await JsonAsync(await owner.PostAsync("/api/cockpit/integrations/giphy/test", null));

        Assert.True(result.GetProperty("connected").GetBoolean());
        var request = Assert.Single(giphy.Requests);
        Assert.Equal("api.giphy.com", request.Host);
        Assert.Equal("/v1/gifs/trending", request.AbsolutePath);
        Assert.Contains("api_key=env-key", request.Query, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "GIPHY odrzuciło klucz (HTTP 403).")]
    [InlineData(HttpStatusCode.Unauthorized, "GIPHY odrzuciło klucz (HTTP 401).")]
    [InlineData(HttpStatusCode.TooManyRequests, "Nie udało się połączyć z GIPHY (HTTP 429).")]
    public async Task TheConnectionCheckSaysWhatGiphyAnswered(HttpStatusCode status, string title)
    {
        using var factory = Factory("env-key", new StubGiphy(status));
        using var owner = await OwnerAsync(factory);

        var response = await owner.PostAsync("/api/cockpit/integrations/giphy/test", null);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var problem = await ProblemAsync(response);
        Assert.Equal(title, problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task TheConnectionCheckReportsAnUnreachableGiphy()
    {
        using var factory = Factory("env-key", new StubGiphy(failure: new HttpRequestException("Name or service not known")));
        using var owner = await OwnerAsync(factory);

        var response = await owner.PostAsync("/api/cockpit/integrations/giphy/test", null);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal(
            "Nie udało się połączyć z GIPHY (Name or service not known).",
            (await ProblemAsync(response)).GetProperty("detail").GetString());
    }

    [Fact]
    public async Task TheConnectionCheckWantsAKeyFirst()
    {
        var giphy = new StubGiphy(HttpStatusCode.OK);
        using var factory = Factory("", giphy);
        using var owner = await OwnerAsync(factory);

        var response = await owner.PostAsync("/api/cockpit/integrations/giphy/test", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(giphy.Requests);
    }

    [Fact]
    public async Task OnlyTheOwnerChecksTheConnection()
    {
        using var factory = Factory("env-key", new StubGiphy(HttpStatusCode.OK));
        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");

        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync("/api/cockpit/integrations/giphy/test", null)).StatusCode);
    }

    [Fact]
    public void TheStateNeverPrintsTheKey()
    {
        Assert.DoesNotContain("secret-key", new GiphyState(true, "secret-key").ToString(), StringComparison.Ordinal);
    }

    private static StellarrWebApplicationFactory Factory(string environmentKey, StubGiphy? giphy = null) => new(
        loadTestData: true,
        new Dictionary<string, string?> { ["GIPHY_API_KEY"] = environmentKey },
        configureServices: giphy is null
            ? null
            : services => services.AddHttpClient<GiphyClient>().ConfigurePrimaryHttpMessageHandler(() => giphy));

    private static async Task<JsonElement> SaveGiphyAsync(HttpClient owner, bool enabled)
    {
        var settings = new Dictionary<string, object?>
        {
            ["instanceName"] = "Orbit",
            ["timeZone"] = "UTC",
            ["mailingEnabled"] = false,
            ["mailFromAddress"] = "stellarr@example.net",
            ["inviteMailEnabled"] = true,
            ["recoveryMailEnabled"] = true,
            ["alertMailEnabled"] = false,
            ["backupRetentionDays"] = 14,
            ["logRetentionDays"] = 30,
            ["orphanObjectRetentionDays"] = 1,
            ["automaticCleanupEnabled"] = true,
            ["giphyEnabled"] = enabled,
        };
        return await JsonAsync(await owner.PutAsJsonAsync("/api/cockpit/settings", settings));
    }

    private static async Task<HttpClient> OwnerAsync(StellarrWebApplicationFactory factory)
    {
        var client = Client(factory);
        await LoginAsync(client, "maja", "Aurora!2026");
        return client;
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) => factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    /// <summary>GIPHY, answering every request with one status, or failing to connect at all.</summary>
    private sealed class StubGiphy(HttpStatusCode status = HttpStatusCode.OK, Exception? failure = null) : HttpMessageHandler
    {
        private readonly List<Uri> _requests = [];

        public IReadOnlyList<Uri> Requests
        {
            get
            {
                lock (_requests) return [.. _requests];
            }
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            lock (_requests) _requests.Add(request.RequestUri!);
            if (failure is not null)
            {
                throw failure;
            }

            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent("""{"data":[]}""") });
        }
    }
}
