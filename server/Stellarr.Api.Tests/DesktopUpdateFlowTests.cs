using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class DesktopUpdateFlowTests
{
    private static readonly JsonSerializerOptions ManifestJson = new() { WriteIndented = true };
    /// <summary>
    /// Shaped like what the bundler actually writes: a comment line, a newline,
    /// then the base64. A single-line stand-in would pass a validator that
    /// rejects the real thing, which is the one mistake this file exists to
    /// catch early.
    /// </summary>
    private const string Signature =
        "untrusted comment: signature from minisign secret key\n" +
        "RWSRGejCl7EEOExTHJ2LUMF6MF1yBuIBWKvgYWuFE0duj3HfmJq9rj4BAAAAAAAAAAA=";

    [Fact]
    public async Task ClientOnAnOlderVersionIsOfferedTheSignedAppImage()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        var bytes = "stellarr-appimage"u8.ToArray();
        PublishUpdate(factory.DataRoot, "0.2.0", bytes);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=0");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("0.2.0", body.GetProperty("version").GetString());
        Assert.Equal(Signature, body.GetProperty("signature").GetString());
        Assert.NotNull(body.GetProperty("pub_date").GetString());
        // The URL is composed from the request, so the same manifest is correct
        // whichever hostname an instance answers on.
        Assert.EndsWith(
            "/api/desktop/update/download/stable/appimage",
            body.GetProperty("url").GetString());

        var download = await client.GetAsync(body.GetProperty("url").GetString());
        download.EnsureSuccessStatusCode();
        Assert.Equal(bytes, await download.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task ClientAlreadyOnThePublishedVersionIsToldThereIsNothing()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray());
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.2.0?channel=stable&bundle=appimage&bucket=0");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    /// <summary>
    /// A package installed by pacman cannot replace its own files, so the
    /// updater reports a bundle type Tauri does not recognise. Handing it an
    /// AppImage would be offering an install it has no way to perform.
    /// </summary>
    [Fact]
    public async Task SystemPackagedClientIsNotOfferedAnAppImageItCannotInstall()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray());
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=unknown&bucket=0");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task StagedRolloutOnlyAnswersTheBucketsItHasReached()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray(), rolloutPercent: 25);
        using var client = factory.CreateClient();

        var inside = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=24");
        var outside = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=25");

        inside.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, outside.StatusCode);
    }

    /// <summary>
    /// A client that cannot say which bucket it is in must not be treated as an
    /// early adopter: an install that forgets its identity every launch would
    /// otherwise walk into every partial rollout.
    /// </summary>
    [Fact]
    public async Task ClientWithoutABucketWaitsForTheFullRollout()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray(), rolloutPercent: 99);
        using var client = factory.CreateClient();

        var partial = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage");
        Assert.Equal(HttpStatusCode.NoContent, partial.StatusCode);

        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray(), rolloutPercent: 100);
        var complete = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage");
        complete.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task BetaChannelIsServedFromItsOwnManifest()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray());
        PublishUpdate(factory.DataRoot, "0.3.0", "stellarr-appimage-beta"u8.ToArray(), channel: "beta");
        using var client = factory.CreateClient();

        var stable = await client.GetFromJsonAsync<JsonElement>(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=0");
        var beta = await client.GetFromJsonAsync<JsonElement>(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=beta&bundle=appimage&bucket=0");

        Assert.Equal("0.2.0", stable.GetProperty("version").GetString());
        Assert.Equal("0.3.0", beta.GetProperty("version").GetString());
    }

    [Fact]
    public async Task UnpublishedChannelAndForeignArchitectureAnswerNothingRatherThanFail()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray());
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=beta&bundle=appimage&bucket=0")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync(
            "/api/desktop/update/linux/aarch64/0.1.9?channel=stable&bundle=appimage&bucket=0")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync(
            "/api/desktop/update/windows/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=0")).StatusCode);
    }

    /// <summary>
    /// A manifest naming a file outside the release directory is the one failure
    /// that must not be answered with "nothing for you": it is a broken or
    /// tampered publication, and saying 204 would hide it behind clients that
    /// simply never update.
    /// </summary>
    [Fact]
    public async Task ManifestReachingOutsideTheReleaseDirectoryIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        PublishUpdate(factory.DataRoot, "0.2.0", "stellarr-appimage"u8.ToArray());
        var directory = Path.Combine(factory.DataRoot, "releases", "desktop");
        var manifestPath = Path.Combine(directory, "desktop-updater.json");
        File.WriteAllText(
            manifestPath,
            File.ReadAllText(manifestPath).Replace(
                "\"fileName\": \"stellarr-desktop-0.2.0-x86_64.AppImage\"",
                "\"fileName\": \"../../../etc/passwd\"",
                StringComparison.Ordinal));
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=0");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task NothingIsPublishedBeforeTheFirstRelease()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = factory.CreateClient();

        var check = await client.GetAsync(
            "/api/desktop/update/linux/x86_64/0.1.9?channel=stable&bundle=appimage&bucket=0");
        var download = await client.GetAsync("/api/desktop/update/download/stable/appimage");

        Assert.Equal(HttpStatusCode.NoContent, check.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    private static void PublishUpdate(
        string dataRoot,
        string version,
        byte[] bytes,
        string channel = "stable",
        int rolloutPercent = 100)
    {
        var directory = Path.Combine(dataRoot, "releases", "desktop");
        Directory.CreateDirectory(directory);
        var fileName = $"stellarr-desktop-{version}-x86_64.AppImage";
        File.WriteAllBytes(Path.Combine(directory, fileName), bytes);
        File.WriteAllText(
            Path.Combine(directory, channel == "beta" ? "desktop-updater-beta.json" : "desktop-updater.json"),
            JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                channel,
                version,
                publishedAt = DateTime.UtcNow,
                notes = $"Stellarr Desktop {version}",
                rolloutPercent,
                artifacts = new[]
                {
                    new
                    {
                        target = "linux",
                        architecture = "x86_64",
                        bundle = "appimage",
                        fileName,
                        sizeBytes = bytes.LongLength,
                        sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)),
                        signature = Signature,
                    },
                },
            }, ManifestJson));
    }
}
