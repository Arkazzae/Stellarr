using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>What the client gate guards and how it reads the headers, beyond the sign-in scenarios.</summary>
public sealed class ClientGateRulesTests
{
    private const string Unsupported = "unsupported-client";
    private const string MissingVersion = "Ta aplikacja nie podaje swojej wersji i nie jest obsługiwana.";

    [Theory]
    [InlineData("POST", "/api/auth/login")]
    [InlineData("POST", "/api/auth/register")]
    [InlineData("POST", "/api/auth/desktop/browser/start")]
    [InlineData("POST", "/api/auth/desktop/browser/exchange")]
    [InlineData("GET", "/api/session")]
    [InlineData("GET", "/api/bootstrap")]
    [InlineData("GET", "/API/Session")]
    public async Task UnidentifiedCallersAreRefusedAtTheDoorToASession(string method, string path)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory);

        using var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path)
        {
            Content = method == "POST" ? JsonContent.Create(new { }) : null,
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(Unsupported, problem.GetProperty("code").GetString());
        Assert.Equal("/", problem.GetProperty("downloadPath").GetString());
        Assert.False(problem.TryGetProperty("minimumVersion", out _));
    }

    [Theory]
    [InlineData("/health/live")]
    [InlineData("/api/auth/oidc")]
    public async Task OtherPathsNeedNoIdentification(string path)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory);

        using var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("web", "2.0.0")]
    [InlineData("WEB", "2.0.0")]
    [InlineData("  web  ", " 2.0.0 ")]
    [InlineData("ops", "0.1.0")]
    [InlineData("mobile-android", "1.4")]
    [InlineData("desktop-linux", "9.9.9.9")]
    public async Task SupportedClientsAreAdmittedWhateverTheirLetterCase(string kind, string version)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory, kind, version);

        using var response = await client.GetAsync("/api/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("two")]
    [InlineData("2")]
    [InlineData("2.0.0-beta")]
    public async Task ClientWithoutAReadableVersionIsRefused(string version)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory, "web", version);

        using var response = await client.GetAsync("/api/session");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(Unsupported, problem.GetProperty("code").GetString());
        Assert.Equal(MissingVersion, problem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task OperatorListOfClientsIsAdmittedNextToTheDefaultOnes()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Clients:Allowed:0"] = "web",
                ["Clients:Allowed:1"] = "kiosk",
            });
        using var kiosk = Client(factory, "kiosk", "1.0.0");
        using var web = Client(factory, "web", "2.0.0");
        using var android = Client(factory, "mobile-android", "1.0.0");
        using var foreign = Client(factory, "voicephy", "9.9.9");

        Assert.Equal(HttpStatusCode.OK, (await kiosk.GetAsync("/api/session")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await web.GetAsync("/api/session")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await android.GetAsync("/api/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await foreign.GetAsync("/api/session")).StatusCode);
    }

    [Fact]
    public async Task SettingsChangedWhileRunningApplyToTheNextRequest()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var anonymous = Client(factory);
        Assert.Equal(HttpStatusCode.Forbidden, (await anonymous.GetAsync("/api/session")).StatusCode);

        factory.Services.GetRequiredService<IConfiguration>()["Clients:RequireIdentification"] = "false";

        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/api/session")).StatusCode);
    }

    [Fact]
    public async Task RefusalNamesTheConfiguredDownloadPageOrNone()
    {
        using var withPage = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Clients:DownloadPath"] = "/pobierz" });
        using var withoutPage = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Clients:DownloadPath"] = "" });
        using var first = Client(withPage);
        using var second = Client(withoutPage);

        var named = await (await first.GetAsync("/api/session")).Content.ReadFromJsonAsync<JsonElement>();
        var silent = await (await second.GetAsync("/api/session")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("/pobierz", named.GetProperty("downloadPath").GetString());
        Assert.False(silent.TryGetProperty("downloadPath", out _));
    }

    [Fact]
    public async Task DisabledIdentificationStillRefusesAClientThatNamesAnotherProduct()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Clients:RequireIdentification"] = "false" });
        using var anonymous = Client(factory);
        using var foreign = Client(factory, "voicephy", "9.9.9");

        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/api/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await foreign.GetAsync("/api/session")).StatusCode);
    }

    [Fact]
    public async Task FloorSavedByTheOperatorOverridesTheConfiguredOne()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Desktop:MinimumVersion"] = "0.1.0" });
        await using (var scope = factory.OpenScope(out var db))
        {
            db.OperationsSettings.Add(new OperationsSettings
            {
                ServerId = TestData.ServerId,
                DesktopMinimumVersion = " 0.3.0 ",
                UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        using var behind = Client(factory, "desktop-linux", "0.2.9");
        using var current = Client(factory, "desktop-linux", "0.3.0");

        using var refused = await behind.GetAsync("/api/session");
        var problem = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("outdated-client", problem.GetProperty("code").GetString());
        Assert.Equal("0.3.0", problem.GetProperty("minimumVersion").GetString());
        Assert.Equal(
            "Ta wersja aplikacji (0.2.9) jest za stara. Wymagana jest co najmniej 0.3.0.",
            problem.GetProperty("title").GetString());
        Assert.Equal(HttpStatusCode.OK, (await current.GetAsync("/api/session")).StatusCode);
    }

    [Fact]
    public async Task OnlyTheDesktopClientHasAFloor()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Desktop:MinimumVersion"] = "5.0.0" });
        using var web = Client(factory, "web", "2.0.0");

        Assert.Equal(HttpStatusCode.OK, (await web.GetAsync("/api/session")).StatusCode);
    }

    [Fact]
    public async Task UnreadableFloorFallsBackToTheConfiguredOneInsteadOfRefusingEveryone()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Desktop:MinimumVersion"] = "0.1.3" });
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Database.ExecuteSqlRawAsync("""DROP TABLE "OperationsSettings";""");
        }

        using var behind = Client(factory, "desktop-linux", "0.1.1");
        using var current = Client(factory, "desktop-linux", "0.1.3");

        using var refused = await behind.GetAsync("/api/session");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal(
            "0.1.3",
            (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("minimumVersion").GetString());
        Assert.Equal(HttpStatusCode.OK, (await current.GetAsync("/api/session")).StatusCode);
    }

    /// <summary>A client that identifies as <paramref name="kind"/>, or as nothing at all.</summary>
    private static HttpClient Client(StellarrWebApplicationFactory factory, string? kind = null, string? version = null)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client");
        client.DefaultRequestHeaders.Remove("X-Stellarr-Client-Version");
        if (kind is not null)
        {
            client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client", kind);
        }

        if (version is not null)
        {
            client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client-Version", version);
        }

        return client;
    }
}
