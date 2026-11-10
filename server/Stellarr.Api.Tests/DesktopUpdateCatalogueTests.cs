using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Stellarr.Api.Tests;

/// <summary>
/// The corners of the desktop updater routes that <see cref="DesktopUpdateFlowTests"/>
/// leaves open: what makes a manifest untrustworthy, how rollout buckets are
/// read and what the responses say about caching.
/// </summary>
public sealed class DesktopUpdateCatalogueTests
{
    private const string Signature =
        "untrusted comment: signature from minisign secret key\n" +
        "RWSRGejCl7EEOExTHJ2LUMF6MF1yBuIBWKvgYWuFE0duj3HfmJq9rj4BAAAAAAAAAAA=";
    private static readonly byte[] AppImage = "stellarr-appimage-bytes"u8.ToArray();

    [Fact]
    public async Task OfferedUpdateIsNotCachedAndNamesItsPublicationTime()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0");
        using var client = factory.CreateClient();

        var response = await client.GetAsync(Check("0.1.9", 0));
        var offer = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("Stellarr Desktop 0.2.0", offer.GetProperty("notes").GetString());
        var publishedAt = offer.GetProperty("pub_date").GetString()!;
        Assert.EndsWith("Z", publishedAt, StringComparison.Ordinal);
        Assert.True(DateTime.Parse(publishedAt, CultureInfo.InvariantCulture) > DateTime.UtcNow.AddMinutes(-5));
    }

    [Theory]
    [InlineData("0.2.0")]
    [InlineData("0.3.0")]
    [InlineData("latest")]
    [InlineData("0.1")]
    [InlineData("0.1.9-beta")]
    public async Task ClientNotBehindThePublishedVersionOrNotSayingItsVersionIsToldThereIsNothing(string installed)
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0");
        using var client = factory.CreateClient();

        var response = await client.GetAsync(Check(installed, 0));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Theory]
    [InlineData(100, 99, HttpStatusCode.OK)]
    [InlineData(100, 1000, HttpStatusCode.OK)]
    [InlineData(100, -1, HttpStatusCode.OK)]
    [InlineData(99, 1000, HttpStatusCode.NoContent)]
    [InlineData(99, -1, HttpStatusCode.NoContent)]
    [InlineData(50, 49, HttpStatusCode.OK)]
    [InlineData(50, 50, HttpStatusCode.NoContent)]
    [InlineData(0, 0, HttpStatusCode.NoContent)]
    public async Task BucketOutsideTheValidRangeCountsAsTheLastOne(int rollout, int bucket, HttpStatusCode expected)
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0", alter: manifest => manifest["rolloutPercent"] = rollout);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(Check("0.1.9", bucket));

        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData("unknown", "appimage")]
    [InlineData("beta", "appimage")]
    [InlineData("stable", "deb")]
    public async Task DownloadOfSomethingNotPublishedIsNotFound(string channel, string bundle)
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0");
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/api/desktop/update/download/{channel}/{bundle}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DownloadIsRevalidatedSoonAndCanBeResumed()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0");
        using var client = factory.CreateClient();
        using var resume = new HttpRequestMessage(HttpMethod.Get, "/api/desktop/update/download/stable/appimage")
        {
            Headers = { Range = new RangeHeaderValue(9, 16) },
        };

        var whole = await client.GetAsync("/api/desktop/update/download/stable/appimage");
        using var part = await client.SendAsync(resume);

        whole.EnsureSuccessStatusCode();
        Assert.Equal("public, max-age=60", whole.Headers.CacheControl?.ToString());
        Assert.Equal("application/octet-stream", whole.Content.Headers.ContentType?.MediaType);
        Assert.Equal(
            "stellarr-desktop-0.2.0-x86_64.AppImage",
            whole.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal(HttpStatusCode.PartialContent, part.StatusCode);
        Assert.Equal(AppImage[9..17], await part.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData("a manifest of another channel")]
    [InlineData("a rollout above one hundred")]
    [InlineData("a rollout below zero")]
    [InlineData("a pre-release version")]
    [InlineData("no artifacts")]
    [InlineData("an unsigned artifact")]
    [InlineData("a signature that is too short")]
    [InlineData("a digest that is not hex")]
    [InlineData("a size the file does not have")]
    [InlineData("a file that is not there")]
    [InlineData("a file name with a current-directory prefix")]
    [InlineData("a file name that detours through a subdirectory")]
    public async Task ManifestThatCannotBeTrustedFailsTheCheckAndTheDownload(string defect)
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0", alter: manifest => Corrupt(manifest, defect));
        using var client = factory.CreateClient();

        var check = await client.GetAsync(Check("0.1.9", 0));
        var download = await client.GetAsync("/api/desktop/update/download/stable/appimage");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, check.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, download.StatusCode);
    }

    [Fact]
    public async Task ManifestThatIsNotJsonFailsTheCheck()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0");
        File.WriteAllText(Path.Combine(factory.DataRoot, "releases", "desktop", "desktop-updater.json"), "not json");
        using var client = factory.CreateClient();

        var check = await client.GetAsync(Check("0.1.9", 0));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, check.StatusCode);
    }

    [Fact]
    public async Task BrokenArtifactOfAnotherPlatformDoesNotTakeUpdatesAwayFromLinux()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, "0.2.0", alter: manifest => manifest["artifacts"]!.AsArray().Add(new JsonObject
        {
            ["target"] = "windows",
            ["architecture"] = "x86_64",
            ["bundle"] = "appimage",
            ["fileName"] = "missing.exe",
            ["sizeBytes"] = 10,
            ["sha256"] = "not-a-digest",
            ["signature"] = Signature,
        }));
        using var client = factory.CreateClient();

        var linux = await client.GetAsync(Check("0.1.9", 0));
        var windows = await client.GetAsync("/api/desktop/update/windows/x86_64/0.1.9?bundle=appimage&bucket=0");

        Assert.Equal(HttpStatusCode.OK, linux.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, windows.StatusCode);
    }

    private static string Check(string installed, int bucket) => string.Create(
        CultureInfo.InvariantCulture,
        $"/api/desktop/update/linux/x86_64/{installed}?channel=stable&bundle=appimage&bucket={bucket}");

    private static void Corrupt(JsonObject manifest, string defect)
    {
        var artifact = manifest["artifacts"]![0]!;
        switch (defect)
        {
            case "a manifest of another channel": manifest["channel"] = "beta"; break;
            case "a rollout above one hundred": manifest["rolloutPercent"] = 101; break;
            case "a rollout below zero": manifest["rolloutPercent"] = -1; break;
            case "a pre-release version": manifest["version"] = "0.2.0-rc1"; break;
            case "no artifacts": manifest["artifacts"] = new JsonArray(); break;
            case "an unsigned artifact": artifact.AsObject().Remove("signature"); break;
            case "a signature that is too short": artifact["signature"] = "RWQ="; break;
            case "a digest that is not hex": artifact["sha256"] = new string('z', 64); break;
            case "a size the file does not have": artifact["sizeBytes"] = AppImage.Length + 1; break;
            case "a file that is not there": artifact["fileName"] = "gone.AppImage"; break;
            // These two resolve to the real package, so only the spelling gives them away.
            case "a file name with a current-directory prefix":
                artifact["fileName"] = "./" + (string)artifact["fileName"]!;
                break;
            case "a file name that detours through a subdirectory":
                artifact["fileName"] = "sub/../" + (string)artifact["fileName"]!;
                break;
            default: throw new ArgumentOutOfRangeException(nameof(defect), defect, null);
        }
    }

    private static void Publish(string dataRoot, string version, Action<JsonObject>? alter = null)
    {
        var directory = Path.Combine(dataRoot, "releases", "desktop");
        Directory.CreateDirectory(directory);
        var fileName = $"stellarr-desktop-{version}-x86_64.AppImage";
        File.WriteAllBytes(Path.Combine(directory, fileName), AppImage);
        var manifest = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["channel"] = "stable",
            ["version"] = version,
            ["publishedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            ["notes"] = $"Stellarr Desktop {version}",
            ["rolloutPercent"] = 100,
            ["artifacts"] = new JsonArray(new JsonObject
            {
                ["target"] = "linux",
                ["architecture"] = "x86_64",
                ["bundle"] = "appimage",
                ["fileName"] = fileName,
                ["sizeBytes"] = AppImage.LongLength,
                ["sha256"] = Convert.ToHexStringLower(SHA256.HashData(AppImage)),
                ["signature"] = Signature,
            }),
        };
        alter?.Invoke(manifest);
        File.WriteAllText(Path.Combine(directory, "desktop-updater.json"), manifest.ToJsonString());
    }
}
