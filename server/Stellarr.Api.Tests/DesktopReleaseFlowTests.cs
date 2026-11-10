using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class DesktopReleaseFlowTests
{
    [Fact]
    public async Task PublicReleaseMetadataAndArchPackageComeFromThePersistentVolume()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        var bytes = "stellarr-arch-package"u8.ToArray();
        PublishDesktop(factory.DataRoot, "0.1.1", bytes);
        using var client = factory.CreateClient();

        var metadata = await client.GetFromJsonAsync<JsonElement>("/api/desktop/release");
        Assert.Equal("0.1.1", metadata.GetProperty("version").GetString());
        Assert.Equal("arch", metadata.GetProperty("platform").GetString());
        Assert.Equal("x86_64", metadata.GetProperty("architecture").GetString());
        Assert.Equal(bytes.Length, metadata.GetProperty("sizeBytes").GetInt64());
        Assert.Equal(
            Convert.ToHexStringLower(SHA256.HashData(bytes)),
            metadata.GetProperty("sha256").GetString());

        var download = await client.GetAsync(metadata.GetProperty("downloadUrl").GetString());
        download.EnsureSuccessStatusCode();
        Assert.Equal("application/zstd", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal(
            "stellarr-desktop-0.1.1-1-x86_64.pkg.tar.zst",
            download.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal(bytes, await download.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task PublicClientCatalogueIncludesTheAndroidApkAndDesktopPackage()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        var desktopBytes = "stellarr-arch-package"u8.ToArray();
        var androidBytes = "stellarr-android-apk"u8.ToArray();
        PublishDesktop(factory.DataRoot, "0.1.3", desktopBytes);
        PublishAndroid(factory.DataRoot, "0.1.0", androidBytes);
        using var client = factory.CreateClient();

        var metadata = await client.GetFromJsonAsync<JsonElement>("/api/android/release");
        Assert.Equal("0.1.0", metadata.GetProperty("version").GetString());
        Assert.Equal("android", metadata.GetProperty("platform").GetString());
        Assert.Equal("arm64-v8a", metadata.GetProperty("architecture").GetString());
        Assert.Equal(androidBytes.Length, metadata.GetProperty("sizeBytes").GetInt64());
        Assert.Equal(
            Convert.ToHexStringLower(SHA256.HashData(androidBytes)),
            metadata.GetProperty("sha256").GetString());

        var download = await client.GetAsync(metadata.GetProperty("downloadUrl").GetString());
        download.EnsureSuccessStatusCode();
        Assert.Equal(
            "application/vnd.android.package-archive",
            download.Content.Headers.ContentType?.MediaType);
        Assert.Equal(
            "stellarr-android-0.1.0-arm64-v8a.apk",
            download.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal(androidBytes, await download.Content.ReadAsByteArrayAsync());

        var releases = await client.GetFromJsonAsync<JsonElement>("/api/client/releases");
        Assert.Equal(2, releases.GetArrayLength());
        Assert.Equal("android", releases[0].GetProperty("platform").GetString());
        Assert.Equal("arch", releases[1].GetProperty("platform").GetString());
    }

    [Fact]
    public async Task BrokenAndroidManifestDoesNotHideAValidDesktopRelease()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishDesktop(factory.DataRoot, "0.1.3", "desktop"u8.ToArray());
        var androidDirectory = Path.Combine(factory.DataRoot, "releases", "android");
        Directory.CreateDirectory(androidDirectory);
        File.WriteAllText(Path.Combine(androidDirectory, "android-release.json"), "{}");
        using var client = factory.CreateClient();

        var releases = await client.GetFromJsonAsync<JsonElement>("/api/client/releases");
        Assert.Equal(1, releases.GetArrayLength());
        Assert.Equal("arch", releases[0].GetProperty("platform").GetString());
        Assert.Equal(
            HttpStatusCode.ServiceUnavailable,
            (await client.GetAsync("/api/android/release")).StatusCode);
    }

    [Fact]
    public async Task OwnerVersionsAreValidatedPersistedAndUsedByDiscovery()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");

        var invalid = await owner.PutAsJsonAsync("/api/ops/desktop-release", new
        {
            minimumVersion = "1.2",
            recommendedVersion = "1.1.0",
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var update = await owner.PutAsJsonAsync("/api/ops/desktop-release", new
        {
            minimumVersion = "0.1.0",
            recommendedVersion = "0.1.1",
        });
        update.EnsureSuccessStatusCode();
        var saved = await JsonAsync(update);
        Assert.Equal("0.1.0", saved.GetProperty("minimumVersion").GetString());
        Assert.Equal("0.1.1", saved.GetProperty("recommendedVersion").GetString());

        var handshake = await owner.GetFromJsonAsync<JsonElement>("/.well-known/stellarr/client");
        var desktop = handshake.GetProperty("desktop");
        Assert.Equal("0.1.0", desktop.GetProperty("minimumVersion").GetString());
        Assert.Equal("0.1.1", desktop.GetProperty("recommendedVersion").GetString());

        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.GetAsync("/api/ops/desktop-release")).StatusCode);
    }

    private static void PublishDesktop(string dataRoot, string version, byte[] bytes)
    {
        var directory = Path.Combine(dataRoot, "releases", "desktop");
        Directory.CreateDirectory(directory);
        var fileName = $"stellarr-desktop-{version}-1-x86_64.pkg.tar.zst";
        File.WriteAllBytes(Path.Combine(directory, fileName), bytes);
        File.WriteAllText(
            Path.Combine(directory, "desktop-release.json"),
            JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                version,
                publishedAt = DateTime.UtcNow,
                notes = $"Stellarr Desktop {version}",
                artifact = new
                {
                    platform = "arch",
                    architecture = "x86_64",
                    fileName,
                    sizeBytes = bytes.LongLength,
                    sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)),
                },
            }));
    }

    private static void PublishAndroid(string dataRoot, string version, byte[] bytes)
    {
        var directory = Path.Combine(dataRoot, "releases", "android");
        Directory.CreateDirectory(directory);
        var fileName = $"stellarr-android-{version}-arm64-v8a.apk";
        File.WriteAllBytes(Path.Combine(directory, fileName), bytes);
        File.WriteAllText(
            Path.Combine(directory, "android-release.json"),
            JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                version,
                publishedAt = DateTime.UtcNow,
                notes = $"Stellarr {version} dla Androida",
                artifact = new
                {
                    platform = "android",
                    architecture = "arm64-v8a",
                    fileName,
                    sizeBytes = bytes.LongLength,
                    sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)),
                },
            }));
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
}
