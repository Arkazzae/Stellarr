using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>What the discovery document says when nothing is configured, and where it takes each value from.</summary>
public sealed class ClientDiscoveryDocumentTests
{
    private const string DiscoveryPath = "/.well-known/stellarr/client";

    [Fact]
    public async Task UnconfiguredInstanceIntroducesItselfByItsServerAndTheRequest()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();

        var document = await client.GetFromJsonAsync<JsonElement>(DiscoveryPath);

        Assert.Equal("Orbit", document.GetProperty("instanceName").GetString());
        Assert.Equal("http://localhost", document.GetProperty("canonicalOrigin").GetString());
        Assert.Equal(JsonValueKind.Null, document.GetProperty("buildSha").ValueKind);
        Assert.Equal("0.1.0", document.GetProperty("desktop").GetProperty("minimumVersion").GetString());
        Assert.Equal("0.1.0", document.GetProperty("desktop").GetProperty("recommendedVersion").GetString());
        Assert.False(string.IsNullOrWhiteSpace(document.GetProperty("serverVersion").GetString()));
    }

    [Fact]
    public async Task InstanceWithoutAnyServerFallsBackToItsConfiguredNameOrTheProductName()
    {
        using var unnamed = new StellarrWebApplicationFactory(loadTestData: false);
        using var named = new StellarrWebApplicationFactory(
            loadTestData: false,
            configuration: new Dictionary<string, string?> { ["Stellarr:InstanceName"] = "  Orbita  " });

        using var unnamedClient = unnamed.CreateClient();
        using var namedClient = named.CreateClient();
        var first = await unnamedClient.GetFromJsonAsync<JsonElement>(DiscoveryPath);
        var second = await namedClient.GetFromJsonAsync<JsonElement>(DiscoveryPath);

        Assert.Equal("Stellarr", first.GetProperty("instanceName").GetString());
        Assert.Equal("Orbita", second.GetProperty("instanceName").GetString());
    }

    [Fact]
    public async Task OriginFollowsTheAddressTheProxyForwarded()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Forwarded-Host", "chat.example.test");
        client.DefaultRequestHeaders.Add("X-Forwarded-Proto", "https");

        var document = await client.GetFromJsonAsync<JsonElement>(DiscoveryPath);

        Assert.Equal("https://chat.example.test", document.GetProperty("canonicalOrigin").GetString());
    }

    [Theory]
    [InlineData("chat.example.test")]
    [InlineData("ftp://chat.example.test")]
    [InlineData("https://operator:secret@chat.example.test")]
    [InlineData("https://chat.example.test/?next=1")]
    [InlineData("https://chat.example.test/#fragment")]
    public async Task MisconfiguredCanonicalOriginIsAServerErrorNotASilentGuess(string origin)
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: false,
            configuration: new Dictionary<string, string?> { ["Desktop:CanonicalOrigin"] = origin });
        using var client = factory.CreateClient();

        var response = await client.GetAsync(DiscoveryPath);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }

    [Fact]
    public async Task IdentityAlreadyOnTheDataVolumeIsKept()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Directory.CreateDirectory(factory.DataRoot);
        await File.WriteAllTextAsync(
            Path.Combine(factory.DataRoot, "instance-id"),
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\n");
        using var client = factory.CreateClient();

        var document = await client.GetFromJsonAsync<JsonElement>(DiscoveryPath);

        Assert.Equal("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", document.GetProperty("instanceId").GetString());
    }

    [Fact]
    public async Task VersionsTheOperatorSavedWinAndAreTheFloorTheGateEnforces()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Desktop:MinimumVersion"] = "0.1.0",
                ["Desktop:RecommendedVersion"] = "0.2.0",
            });
        await using (var scope = factory.OpenScope(out var db))
        {
            db.OperationsSettings.Add(new OperationsSettings
            {
                ServerId = TestData.ServerId,
                DesktopMinimumVersion = " 0.3.0 ",
                DesktopRecommendedVersion = null,
                UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        using var client = factory.CreateClient();
        using var oldDesktop = factory.CreateClient();
        oldDesktop.DefaultRequestHeaders.Remove("X-Stellarr-Client");
        oldDesktop.DefaultRequestHeaders.Remove("X-Stellarr-Client-Version");
        oldDesktop.DefaultRequestHeaders.Add("X-Stellarr-Client", "desktop-linux");
        oldDesktop.DefaultRequestHeaders.Add("X-Stellarr-Client-Version", "0.2.9");

        var document = await client.GetFromJsonAsync<JsonElement>(DiscoveryPath);
        var refused = await oldDesktop.GetAsync("/api/session");
        var problem = await refused.Content.ReadFromJsonAsync<JsonElement>();

        var desktop = document.GetProperty("desktop");
        Assert.Equal("0.3.0", desktop.GetProperty("minimumVersion").GetString());
        // An unsaved recommendation still comes from the configuration.
        Assert.Equal("0.2.0", desktop.GetProperty("recommendedVersion").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal(
            desktop.GetProperty("minimumVersion").GetString(),
            problem.GetProperty("minimumVersion").GetString());
    }
}
