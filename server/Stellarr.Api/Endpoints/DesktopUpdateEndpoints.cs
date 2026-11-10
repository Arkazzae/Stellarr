using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Stellarr.Api.Endpoints;

internal sealed record DesktopUpdateArtifactManifest(
    string? Target,
    string? Architecture,
    string? Bundle,
    string? FileName,
    long SizeBytes,
    string? Sha256,
    string? Signature);

internal sealed record DesktopUpdateManifest(
    int SchemaVersion,
    string? Channel,
    string? Version,
    DateTime PublishedAt,
    string? Notes,
    int RolloutPercent,
    IReadOnlyList<DesktopUpdateArtifactManifest?>? Artifacts);

/// <summary>One update artifact, checked against the file on the data volume.</summary>
/// <param name="RolloutPercent">The share of clients, counted in buckets from 0, that may take the update.</param>
/// <param name="Signature">What the client verifies the download against.</param>
public sealed record DesktopUpdateCandidate(
    string Version,
    DateTime PublishedAt,
    string Notes,
    int RolloutPercent,
    string Signature,
    string FileName,
    string FilePath);

/// <summary>
/// The signed artifacts an installed client may update itself to.
///
/// This is deliberately a manifest of its own, apart from the one behind the
/// downloadable package: that one is offered to a person in a browser, this one
/// is a contract that a program verifies with a key. Publishing one then cannot
/// make the other unreadable, and the updater's schema can change without
/// touching a route that production already serves.
/// </summary>
public sealed partial class DesktopUpdateCatalogue(IConfiguration configuration)
{
    private const string StableManifestFileName = "desktop-updater.json";
    private const string BetaManifestFileName = "desktop-updater-beta.json";

    public static bool IsKnownChannel(string? channel) => channel is "stable" or "beta";

    /// <returns>The artifact, or null when nothing is published for these arguments.</returns>
    /// <exception cref="InvalidDataException">A manifest is published but cannot be trusted.</exception>
    public DesktopUpdateCandidate? Find(string channel, string target, string architecture, string bundle)
    {
        if (!IsKnownChannel(channel))
        {
            return null;
        }

        var directory = ReleaseManifests.DirectoryFor(configuration, "desktop");
        var manifestFileName = channel == "beta" ? BetaManifestFileName : StableManifestFileName;
        if (ReleaseManifests.Read<DesktopUpdateManifest>(Path.Combine(directory, manifestFileName)) is not { } manifest)
        {
            return null;
        }

        if (!ReleaseManifests.HasValidHeader(
                manifest.SchemaVersion, manifest.Version, manifest.PublishedAt, manifest.Notes) ||
            manifest.Channel != channel ||
            manifest.RolloutPercent is < 0 or > 100 ||
            manifest.Artifacts is not { Count: > 0 } artifacts)
        {
            throw new InvalidDataException("The manifest has invalid fields.");
        }

        // Only the artifact asked for is checked, so a broken build for another
        // platform does not take updates away from the platforms that work.
        var artifact = artifacts.FirstOrDefault(candidate =>
            candidate?.Target == target &&
            candidate.Architecture == architecture &&
            candidate.Bundle == bundle);
        if (artifact is null)
        {
            return null;
        }

        if (!IsSignature(artifact.Signature))
        {
            throw new InvalidDataException("The artifact has no usable signature.");
        }

        var filePath = ReleaseManifests.ResolveArtifact(
            directory, artifact.FileName, artifact.SizeBytes, artifact.Sha256);
        return new DesktopUpdateCandidate(
            manifest.Version.Trim(),
            manifest.PublishedAt.ToUniversalTime(),
            manifest.Notes.Trim(),
            manifest.RolloutPercent,
            artifact.Signature,
            artifact.FileName,
            filePath);
    }

    private static bool IsSignature([NotNullWhen(true)] string? value) =>
        value is not null && SignaturePattern().IsMatch(value);

    // Minisign signatures are base64 together with the comment lines that the
    // bundler writes around it.
    [GeneratedRegex(@"^[A-Za-z0-9+/=\r\n:. _-]{64,4096}$", RegexOptions.CultureInvariant)]
    private static partial Regex SignaturePattern();
}

/// <summary>
/// The routes that the updater inside an installed desktop client calls. Both
/// templates, the query names and the response body are fixed by that updater.
/// </summary>
public static class DesktopUpdateEndpoints
{
    // The one bundle that can replace its own files. A package installed by
    // the system package manager cannot, and offering it an AppImage would be
    // offering an install it has no way to perform.
    private const string SelfUpdatingBundle = "appimage";
    private const int LastRolloutBucket = 99;
    private const string UnavailableTitle = "Aktualizacja desktopowa jest chwilowo niedostępna.";

    /// <summary>The body that the Tauri updater expects from a dynamic update server.</summary>
    private sealed record UpdateResponse(
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("pub_date")] string PublishedAt,
        [property: JsonPropertyName("url")] string Url,
        [property: JsonPropertyName("signature")] string Signature,
        [property: JsonPropertyName("notes")] string Notes);

    public static IEndpointRouteBuilder MapDesktopUpdateEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/desktop/update/{target}/{architecture}/{currentVersion}", CheckUpdate);
        endpoints.MapGet("/api/desktop/update/download/{channel}/{bundle}", DownloadArtifact);
        return endpoints;
    }

    /// <summary>
    /// Answers an installed client asking whether it should replace itself.
    /// Every refusal is <c>204</c> and never <c>404</c>: up to date, outside
    /// the current stage of the rollout, an unknown channel and a bundle that
    /// updates through the package manager all mean "nothing for you" to the
    /// updater, and only a failure should read as an error worth reporting.
    /// A manifest that cannot be trusted is that failure, and answers 503.
    /// </summary>
    private static IResult CheckUpdate(
        HttpContext http,
        DesktopUpdateCatalogue catalogue,
        string target,
        string architecture,
        string currentVersion,
        string? channel,
        string? bundle,
        int? bucket)
    {
        channel ??= "stable";
        bundle ??= SelfUpdatingBundle;
        if (bundle != SelfUpdatingBundle ||
            !DesktopReleaseEndpoints.TryParseStableVersion(currentVersion, out var installed))
        {
            return Results.NoContent();
        }

        DesktopUpdateCandidate? candidate;
        try
        {
            candidate = catalogue.Find(channel, target, architecture, bundle);
        }
        catch (InvalidDataException)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: UnavailableTitle);
        }

        if (candidate is null ||
            !DesktopReleaseEndpoints.TryParseStableVersion(candidate.Version, out var published) ||
            published <= installed)
        {
            return Results.NoContent();
        }

        // A staged rollout belongs to the release, not to the client. A client
        // that cannot say which bucket it is in must not be taken for an early
        // adopter, or an install that forgets its identity on every launch
        // would walk into each partial rollout.
        var clientBucket = bucket is >= 0 and <= LastRolloutBucket ? bucket.Value : LastRolloutBucket;
        if (clientBucket >= candidate.RolloutPercent)
        {
            return Results.NoContent();
        }

        var request = http.Request;
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new UpdateResponse(
            candidate.Version,
            candidate.PublishedAt.ToString("o", CultureInfo.InvariantCulture),
            $"{request.Scheme}://{request.Host}/api/desktop/update/download/{channel}/{bundle}",
            candidate.Signature,
            candidate.Notes));
    }

    private static IResult DownloadArtifact(
        HttpContext http,
        DesktopUpdateCatalogue catalogue,
        string channel,
        string bundle)
    {
        DesktopUpdateCandidate? candidate;
        try
        {
            // Only Linux x86_64 builds publish updater artifacts.
            candidate = catalogue.Find(channel, "linux", "x86_64", bundle);
        }
        catch (InvalidDataException)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: UnavailableTitle);
        }

        if (candidate is null)
        {
            return Results.NotFound();
        }

        http.Response.Headers.CacheControl = ClientReleaseResults.CacheControl;
        return Results.File(
            candidate.FilePath,
            "application/octet-stream",
            candidate.FileName,
            lastModified: candidate.PublishedAt,
            enableRangeProcessing: true);
    }
}
