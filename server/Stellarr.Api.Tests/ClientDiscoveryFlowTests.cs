using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class ClientDiscoveryFlowTests
{
    [Fact]
    public async Task AnonymousDesktopHandshakeDescribesTheCompatibleInstance()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: false,
            configuration: new Dictionary<string, string?>
            {
                ["Stellarr:InstanceId"] = "11111111-2222-4333-8444-555555555555",
                ["Stellarr:InstanceName"] = "Orbita",
                ["Desktop:CanonicalOrigin"] = "https://chat.example.test/",
                ["Desktop:MinimumVersion"] = "0.1.0",
                ["Desktop:RecommendedVersion"] = "0.2.0",
                ["Build:Sha"] = "abc1234",
            });
        using var client = factory.CreateClient();

        var handshake = await client.GetFromJsonAsync<JsonElement>(
            "/.well-known/stellarr/client");

        Assert.Equal("stellarr", handshake.GetProperty("product").GetString());
        Assert.Equal(
            "11111111-2222-4333-8444-555555555555",
            handshake.GetProperty("instanceId").GetString());
        Assert.Equal("Orbita", handshake.GetProperty("instanceName").GetString());
        Assert.Equal("https://chat.example.test", handshake.GetProperty("canonicalOrigin").GetString());
        Assert.Equal("abc1234", handshake.GetProperty("buildSha").GetString());
        Assert.Equal(1, handshake.GetProperty("apiProtocol").GetInt32());
        Assert.Equal(1, handshake.GetProperty("apiProtocolMin").GetInt32());
        Assert.Equal(1, handshake.GetProperty("apiProtocolMax").GetInt32());
        Assert.Equal(1, handshake.GetProperty("rtcProtocol").GetInt32());
        Assert.Contains(
            "password",
            handshake.GetProperty("auth").EnumerateArray().Select(item => item.GetString()));
        var desktop = handshake.GetProperty("desktop");
        Assert.Equal("0.1.0", desktop.GetProperty("minimumVersion").GetString());
        Assert.Equal("0.2.0", desktop.GetProperty("recommendedVersion").GetString());
    }

    [Fact]
    public async Task GeneratedInstanceIdentitySurvivesAnApplicationRestart()
    {
        var dataRoot = Path.Combine(Path.GetTempPath(), $"stellarr-discovery-{Guid.NewGuid():N}");
        var databasePath = Path.Combine(Path.GetTempPath(), $"stellarr-discovery-{Guid.NewGuid():N}.db");
        try
        {
            string firstId;
            using (var first = new StellarrWebApplicationFactory(
                loadTestData: false,
                databasePath: databasePath,
                dataRoot: dataRoot,
                deleteStorageOnDispose: false))
            using (var client = first.CreateClient())
            {
                var handshake = await client.GetFromJsonAsync<JsonElement>(
                    "/.well-known/stellarr/client");
                firstId = handshake.GetProperty("instanceId").GetString()!;
            }

            using var restarted = new StellarrWebApplicationFactory(
                loadTestData: false,
                databasePath: databasePath,
                dataRoot: dataRoot,
                deleteStorageOnDispose: false);
            using var restartedClient = restarted.CreateClient();
            var restartedHandshake = await restartedClient.GetFromJsonAsync<JsonElement>(
                "/.well-known/stellarr/client");

            Assert.Equal(firstId, restartedHandshake.GetProperty("instanceId").GetString());
        }
        finally
        {
            if (File.Exists(databasePath)) File.Delete(databasePath);
            if (Directory.Exists(dataRoot)) Directory.Delete(dataRoot, recursive: true);
        }
    }
}
