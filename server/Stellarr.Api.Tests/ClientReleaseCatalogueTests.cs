using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Stellarr.Api.Endpoints;

namespace Stellarr.Api.Tests;

/// <summary>
/// The desktop and Android packages an operator publishes on the data volume:
/// a manifest beside the file it describes, under <c>releases/desktop</c> and
/// <c>releases/android</c>.
/// </summary>
public sealed class ClientReleaseCatalogueTests
{
    private static readonly byte[] Package = "stellarr-package-bytes"u8.ToArray();

    private sealed record Platform(
        string Folder,
        string ManifestFile,
        string PackageFileName,
        string Name,
        string Architecture,
        string DescribeRoute,
        string DownloadRoute,
        string ContentType);

    private static readonly Platform Desktop = new(
        "desktop",
        "desktop-release.json",
        "stellarr-desktop-{0}-1-x86_64.pkg.tar.zst",
        "arch",
        "x86_64",
        "/api/desktop/release",
        "/api/desktop/release/arch",
        "application/zstd");

    private static readonly Platform Android = new(
        "android",
        "android-release.json",
        "stellarr-android-{0}-arm64-v8a.apk",
        "android",
        "arm64-v8a",
        "/api/android/release",
        "/api/android/release/apk",
        "application/vnd.android.package-archive");

    private static Platform Named(string name) => name == "desktop" ? Desktop : Android;

    public static TheoryData<string, string> BrokenManifests()
    {
        var cases = new TheoryData<string, string>();
        foreach (var platform in new[] { "desktop", "android" })
        {
            foreach (var name in Corruptions.Keys)
            {
                cases.Add(platform, name);
            }
        }

        return cases;
    }

    private static readonly Dictionary<string, Action<JsonObject>> Corruptions = new()
    {
        ["unknown schema version"] = manifest => manifest["schemaVersion"] = 2,
        ["pre-release version"] = manifest => manifest["version"] = "1.2.3-beta",
        ["no publication time"] = manifest => manifest.Remove("publishedAt"),
        ["notes that are too long"] = manifest => manifest["notes"] = new string('x', 2_001),
        ["no artifact"] = manifest => manifest.Remove("artifact"),
        ["another platform"] = manifest => manifest["artifact"]!["platform"] = "windows",
        ["another architecture"] = manifest => manifest["artifact"]!["architecture"] = "riscv64",
        ["malformed digest"] = manifest => manifest["artifact"]!["sha256"] = "ABC",
        ["no declared size"] = manifest => manifest["artifact"]!["sizeBytes"] = 0,
        ["size the file does not have"] = manifest => manifest["artifact"]!["sizeBytes"] = Package.Length + 1,
        ["file that is not there"] = manifest => manifest["artifact"]!["fileName"] = "missing.bin",
        ["file name that climbs out of the directory"] = manifest => manifest["artifact"]!["fileName"] = "..",
        ["blank file name"] = manifest => manifest["artifact"]!["fileName"] = " ",
        // Each of these resolves to the real package, so only the spelling gives them away.
        ["file name with a current-directory prefix"] = manifest => PrefixFileName(manifest, "./"),
        ["file name that detours through a subdirectory"] = manifest => PrefixFileName(manifest, "sub/../"),
    };

    private static void PrefixFileName(JsonObject manifest, string prefix) =>
        manifest["artifact"]!["fileName"] = prefix + (string)manifest["artifact"]!["fileName"]!;

    [Theory]
    [InlineData("desktop")]
    [InlineData("android")]
    public async Task NothingIsServedBeforeTheFirstRelease(string platformName)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(platform.DescribeRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(platform.DownloadRoute)).StatusCode);
        var listing = await client.GetFromJsonAsync<JsonElement>("/api/client/releases");
        Assert.Equal(0, listing.GetArrayLength());
    }

    [Theory]
    [InlineData("desktop")]
    [InlineData("android")]
    public async Task PublishedReleaseIsDescribedAndItsPackageStreamed(string platformName)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, platform, "0.4.2", manifest =>
        {
            manifest["version"] = " 0.4.2 ";
            manifest["notes"] = "  Faster start  ";
        });
        using var client = factory.CreateClient();

        var describe = await client.GetAsync(platform.DescribeRoute);
        describe.EnsureSuccessStatusCode();
        var metadata = await describe.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("public, max-age=60", describe.Headers.CacheControl?.ToString());
        Assert.Equal("0.4.2", metadata.GetProperty("version").GetString());
        Assert.Equal("Faster start", metadata.GetProperty("notes").GetString());
        Assert.Equal(platform.Name, metadata.GetProperty("platform").GetString());
        Assert.Equal(platform.Architecture, metadata.GetProperty("architecture").GetString());
        Assert.Equal(FileName(platform, "0.4.2"), metadata.GetProperty("fileName").GetString());
        Assert.Equal(Package.Length, metadata.GetProperty("sizeBytes").GetInt64());
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Package)), metadata.GetProperty("sha256").GetString());
        Assert.Equal(platform.DownloadRoute, metadata.GetProperty("downloadUrl").GetString());
        Assert.True(metadata.GetProperty("publishedAt").GetDateTime() > DateTime.UtcNow.AddMinutes(-5));

        var download = await client.GetAsync(metadata.GetProperty("downloadUrl").GetString());
        download.EnsureSuccessStatusCode();
        Assert.Equal(platform.ContentType, download.Content.Headers.ContentType?.MediaType);
        Assert.Equal(FileName(platform, "0.4.2"), download.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal("public, max-age=60", download.Headers.CacheControl?.ToString());
        Assert.Equal(Package, await download.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData("desktop")]
    [InlineData("android")]
    public async Task InterruptedDownloadCanResumeWithARangeRequest(string platformName)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, platform, "0.4.2");
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, platform.DownloadRoute)
        {
            Headers = { Range = new RangeHeaderValue(8, 14) },
        };

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal(Package[8..15], await response.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData("desktop")]
    [InlineData("android")]
    public async Task NewReleaseIsServedWithoutRestartingTheServer(string platformName)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = factory.CreateClient();
        Publish(factory.DataRoot, platform, "0.1.0");
        var first = await client.GetFromJsonAsync<JsonElement>(platform.DescribeRoute);

        Publish(factory.DataRoot, platform, "0.2.0");
        var second = await client.GetFromJsonAsync<JsonElement>(platform.DescribeRoute);
        File.Delete(Path.Combine(factory.DataRoot, "releases", platform.Folder, platform.ManifestFile));
        var withdrawn = await client.GetAsync(platform.DescribeRoute);

        Assert.Equal("0.1.0", first.GetProperty("version").GetString());
        Assert.Equal("0.2.0", second.GetProperty("version").GetString());
        Assert.Equal(HttpStatusCode.NotFound, withdrawn.StatusCode);
    }

    [Theory]
    [InlineData("desktop")]
    [InlineData("android")]
    public async Task ManifestThatIsNotJsonIsUnavailableRatherThanMissing(string platformName)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, platform, "0.4.2");
        File.WriteAllText(ManifestPath(factory.DataRoot, platform), "{ this is not json");
        using var client = factory.CreateClient();

        await AssertUnavailableAsync(client, platform);
    }

    [Theory]
    [InlineData("desktop", "null")]
    [InlineData("android", "null")]
    [InlineData("desktop", "[]")]
    [InlineData("android", "{}")]
    public async Task ManifestWithNoUsableContentIsUnavailable(string platformName, string content)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, platform, "0.4.2");
        File.WriteAllText(ManifestPath(factory.DataRoot, platform), content);
        using var client = factory.CreateClient();

        await AssertUnavailableAsync(client, platform);
    }

    [Theory]
    [MemberData(nameof(BrokenManifests))]
    public async Task ManifestThatCannotBeTrustedIsUnavailable(string platformName, string corruption)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, platform, "0.4.2", Corruptions[corruption]);
        using var client = factory.CreateClient();

        await AssertUnavailableAsync(client, platform);
    }

    [Theory]
    [InlineData("desktop", false)]
    [InlineData("desktop", true)]
    [InlineData("android", false)]
    [InlineData("android", true)]
    public async Task PackageOutsideTheReleaseDirectoryIsNeverServed(string platformName, bool absolute)
    {
        var platform = Named(platformName);
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        // The same size as declared, so that only its location gives it away.
        var outside = Path.Combine(factory.DataRoot, "releases", "outside.bin");
        Publish(factory.DataRoot, platform, "0.4.2", manifest =>
            manifest["artifact"]!["fileName"] = absolute ? outside : "../outside.bin");
        File.WriteAllBytes(outside, Package);
        using var client = factory.CreateClient();

        await AssertUnavailableAsync(client, platform);
    }

    [Fact]
    public async Task ListingNamesTheAndroidReleaseFirstAndThenTheDesktopOne()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, Desktop, "0.1.3");
        Publish(factory.DataRoot, Android, "0.1.0");
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/client/releases");
        var releases = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.Equal("public, max-age=60", response.Headers.CacheControl?.ToString());
        Assert.Equal(2, releases.GetArrayLength());
        Assert.Equal("android", releases[0].GetProperty("platform").GetString());
        Assert.Equal(Android.DownloadRoute, releases[0].GetProperty("downloadUrl").GetString());
        Assert.Equal("arch", releases[1].GetProperty("platform").GetString());
        Assert.Equal(Desktop.DownloadRoute, releases[1].GetProperty("downloadUrl").GetString());
    }

    [Theory]
    [InlineData("desktop")]
    [InlineData("android")]
    public async Task ListingStillOffersTheOtherPlatformWhenOneManifestIsBroken(string brokenName)
    {
        var broken = Named(brokenName);
        var healthy = broken == Desktop ? Android : Desktop;
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        Publish(factory.DataRoot, healthy, "0.1.3");
        Publish(factory.DataRoot, broken, "0.1.3");
        File.WriteAllText(ManifestPath(factory.DataRoot, broken), "{}");
        using var client = factory.CreateClient();

        var releases = await client.GetFromJsonAsync<JsonElement>("/api/client/releases");

        Assert.Equal(1, releases.GetArrayLength());
        Assert.Equal(healthy.Name, releases[0].GetProperty("platform").GetString());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync(broken.DescribeRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(healthy.DescribeRoute)).StatusCode);
    }

    [Theory]
    [InlineData("1.2.3", true)]
    [InlineData(" 10.20.30 ", true)]
    [InlineData("000.001.002", true)]
    [InlineData("999999999.0.0", true)]
    [InlineData("1.2", false)]
    [InlineData("1.2.3.4", false)]
    [InlineData("1.2.3-beta", false)]
    [InlineData("1.2.x", false)]
    [InlineData("1..3", false)]
    [InlineData("-1.2.3", false)]
    [InlineData("+1.2.3", false)]
    [InlineData("1.2.٣", false)]
    [InlineData("1000000000.0.0", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyThreeNumberStableVersionsAreAccepted(string? value, bool accepted)
    {
        Assert.Equal(accepted, DesktopReleaseEndpoints.TryParseStableVersion(value, out var version));
        if (accepted)
        {
            Assert.Equal(Version.Parse(value!.Trim()), version);
        }
    }

    private static async Task AssertUnavailableAsync(HttpClient client, Platform platform)
    {
        var describe = await client.GetAsync(platform.DescribeRoute);
        var download = await client.GetAsync(platform.DownloadRoute);
        var listing = await client.GetAsync("/api/client/releases");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, describe.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, download.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, listing.StatusCode);
    }

    private static string FileName(Platform platform, string version) =>
        string.Format(CultureInfo.InvariantCulture, platform.PackageFileName, version);

    private static string ManifestPath(string dataRoot, Platform platform) =>
        Path.Combine(dataRoot, "releases", platform.Folder, platform.ManifestFile);

    /// <summary>Writes the package and a manifest for it the way the deploy script does.</summary>
    /// <param name="alter">Changes the manifest before it is written.</param>
    private static void Publish(string dataRoot, Platform platform, string version, Action<JsonObject>? alter = null)
    {
        var directory = Path.Combine(dataRoot, "releases", platform.Folder);
        Directory.CreateDirectory(directory);
        var fileName = FileName(platform, version);
        File.WriteAllBytes(Path.Combine(directory, fileName), Package);
        var manifest = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["version"] = version,
            ["publishedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            ["notes"] = $"Release {version}",
            ["artifact"] = new JsonObject
            {
                ["platform"] = platform.Name,
                ["architecture"] = platform.Architecture,
                ["fileName"] = fileName,
                ["sizeBytes"] = Package.LongLength,
                ["sha256"] = Convert.ToHexStringLower(SHA256.HashData(Package)),
            },
        };
        alter?.Invoke(manifest);
        File.WriteAllText(ManifestPath(dataRoot, platform), manifest.ToJsonString());
    }
}
