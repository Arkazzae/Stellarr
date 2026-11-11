using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.Json;
using Stellarr.Api.Contracts;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>The Arch Linux package of the desktop client, which a person downloads in a browser.</summary>
public sealed class DesktopReleaseCatalogue(IConfiguration configuration) : ClientReleaseCatalogue(
    configuration,
    new ClientReleaseKind(
        DirectoryName: "desktop",
        ManifestFileName: "desktop-release.json",
        Platform: "arch",
        Architecture: "x86_64",
        DownloadPath: DesktopReleaseEndpoints.ArchDownloadPath,
        ContentType: "application/zstd",
        Unavailable: MessageKey.DesktopReleaseUnavailable));

public static class DesktopReleaseEndpoints
{
    public const string ArchDownloadPath = "/api/desktop/release/arch";

    public static IEndpointRouteBuilder MapDesktopReleaseEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/desktop/release",
            (HttpContext http, DesktopReleaseCatalogue catalogue, Messages messages) =>
                ClientReleaseResults.Describe(http, catalogue, messages));
        endpoints.MapGet(
            ArchDownloadPath,
            (HttpContext http, DesktopReleaseCatalogue catalogue, Messages messages) =>
                ClientReleaseResults.Download(http, catalogue, messages));
        return endpoints;
    }

    /// <summary>
    /// Accepts <c>major.minor.patch</c> and nothing else: no pre-release
    /// suffix, no fourth part, and parts short enough to fit an integer.
    /// </summary>
    internal static bool TryParseStableVersion(string? value, out Version version)
    {
        version = new Version();
        var parts = value?.Trim().Split('.');
        if (parts is not { Length: 3 } || !parts.All(IsVersionNumber))
        {
            return false;
        }

        version = new Version(
            int.Parse(parts[0], CultureInfo.InvariantCulture),
            int.Parse(parts[1], CultureInfo.InvariantCulture),
            int.Parse(parts[2], CultureInfo.InvariantCulture));
        return true;
    }

    private static bool IsVersionNumber(string part) => part.Length is >= 1 and <= 9 && part.All(char.IsAsciiDigit);
}

/// <summary>Where one platform's release is published and what its manifest must declare.</summary>
/// <param name="DirectoryName">The folder under <c>{DataRoot}/releases</c>.</param>
/// <param name="DownloadPath">Where this server serves the package.</param>
/// <param name="Unavailable">What a client is told when the manifest is broken.</param>
public sealed record ClientReleaseKind(
    string DirectoryName,
    string ManifestFileName,
    string Platform,
    string Architecture,
    string DownloadPath,
    string ContentType,
    MessageKey Unavailable);

internal sealed record ClientReleaseManifest(
    int SchemaVersion,
    string? Version,
    DateTime PublishedAt,
    string? Notes,
    ClientReleaseArtifactManifest? Artifact);

internal sealed record ClientReleaseArtifactManifest(
    string? Platform,
    string? Architecture,
    string? FileName,
    long SizeBytes,
    string? Sha256);

/// <summary>A release whose manifest has been checked against the package on disk.</summary>
/// <param name="FilePath">Where the package lies on the data volume.</param>
public sealed record PublishedClientRelease(
    string Version,
    DateTime PublishedAt,
    string Notes,
    string Platform,
    string Architecture,
    string FileName,
    long SizeBytes,
    string Sha256,
    string DownloadPath,
    string FilePath)
{
    public ClientReleaseDto ToDto() => new(
        Version, PublishedAt, Notes, Platform, Architecture, FileName, SizeBytes, Sha256, DownloadPath);
}

/// <summary>
/// The package of one platform that the deploy script publishes next to its
/// manifest on the data volume. Keeping it outside the image makes a release of
/// a native client possible without rebuilding or restarting the server.
/// </summary>
public abstract class ClientReleaseCatalogue(IConfiguration configuration, ClientReleaseKind kind)
{
    public ClientReleaseKind Kind { get; } = kind;

    /// <returns>The published release, or null when there is none.</returns>
    /// <exception cref="InvalidDataException">A manifest is published but cannot be trusted.</exception>
    public PublishedClientRelease? Current()
    {
        var directory = ReleaseManifests.DirectoryFor(configuration, Kind.DirectoryName);
        var manifestPath = Path.Combine(directory, Kind.ManifestFileName);
        if (ReleaseManifests.Read<ClientReleaseManifest>(manifestPath) is not { } manifest)
        {
            return null;
        }

        if (!ReleaseManifests.HasValidHeader(
                manifest.SchemaVersion, manifest.Version, manifest.PublishedAt, manifest.Notes) ||
            manifest.Artifact is not { } artifact ||
            artifact.Platform != Kind.Platform ||
            artifact.Architecture != Kind.Architecture)
        {
            throw new InvalidDataException("The manifest has invalid fields.");
        }

        var filePath = ReleaseManifests.ResolveArtifact(
            directory, artifact.FileName, artifact.SizeBytes, artifact.Sha256);
        return new PublishedClientRelease(
            manifest.Version.Trim(),
            manifest.PublishedAt.ToUniversalTime(),
            manifest.Notes.Trim(),
            Kind.Platform,
            Kind.Architecture,
            artifact.FileName,
            artifact.SizeBytes,
            artifact.Sha256,
            Kind.DownloadPath,
            filePath);
    }
}

/// <summary>The answers that every platform's release routes share.</summary>
internal static class ClientReleaseResults
{
    // The download address stands for whatever release is newest, so it is
    // revalidated soon after a release instead of being cached as immutable.
    public const string CacheControl = "public, max-age=60";

    public static IResult Describe(HttpContext http, ClientReleaseCatalogue catalogue, Messages messages) =>
        Respond(http, catalogue, messages, release => Results.Ok(release.ToDto()));

    public static IResult Download(HttpContext http, ClientReleaseCatalogue catalogue, Messages messages) =>
        Respond(http, catalogue, messages, release => Results.File(
            release.FilePath,
            catalogue.Kind.ContentType,
            release.FileName,
            lastModified: release.PublishedAt,
            enableRangeProcessing: true));

    public static IResult Unavailable(Messages messages, MessageKey title) =>
        Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: messages.Get(title));

    private static IResult Respond(
        HttpContext http,
        ClientReleaseCatalogue catalogue,
        Messages messages,
        Func<PublishedClientRelease, IResult> answer)
    {
        try
        {
            if (catalogue.Current() is not { } release)
            {
                return Results.NotFound();
            }

            http.Response.Headers.CacheControl = CacheControl;
            return answer(release);
        }
        catch (InvalidDataException)
        {
            return Unavailable(messages, catalogue.Kind.Unavailable);
        }
    }
}

/// <summary>
/// Reads what the deploy scripts publish under <c>{DataRoot}/releases</c>: a
/// JSON manifest beside the files it describes. No manifest means nothing is
/// published. A manifest that cannot be trusted raises
/// <see cref="InvalidDataException"/>, which the endpoints answer with 503;
/// a 404 or 204 there would hide a broken publication behind clients that
/// merely never update.
/// </summary>
internal static class ReleaseManifests
{
    private const int SupportedSchemaVersion = 1;
    private const int MaxNotesLength = 2_000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string DirectoryFor(IConfiguration configuration, string name) =>
        Path.GetFullPath(Path.Combine(configuration["DataRoot"] ?? "data", "releases", name));

    /// <returns>The manifest, or null when none is published.</returns>
    public static T? Read<T>(string manifestPath) where T : class
    {
        string json;
        try
        {
            json = File.ReadAllText(manifestPath);
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions)
                ?? throw new InvalidDataException("The manifest is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("The manifest is not valid JSON.", exception);
        }
    }

    /// <summary>The fields that every kind of manifest starts with.</summary>
    public static bool HasValidHeader(
        int schemaVersion,
        [NotNullWhen(true)] string? version,
        DateTime publishedAt,
        [NotNullWhen(true)] string? notes) =>
        schemaVersion == SupportedSchemaVersion &&
        DesktopReleaseEndpoints.TryParseStableVersion(version, out _) &&
        publishedAt != default &&
        notes is { Length: <= MaxNotesLength };

    /// <summary>
    /// The path of the file an artifact names. The name must be a plain file
    /// name inside the release directory and the file must have exactly the
    /// declared size, so that a package still being copied is never served.
    /// </summary>
    /// <exception cref="InvalidDataException">The artifact cannot be served.</exception>
    public static string ResolveArtifact(
        string releaseDirectory,
        [NotNull] string? fileName,
        long sizeBytes,
        [NotNull] string? sha256)
    {
        if (string.IsNullOrWhiteSpace(fileName) ||
            !string.Equals(Path.GetFileName(fileName), fileName, StringComparison.Ordinal) ||
            sizeBytes < 1 ||
            !IsSha256(sha256))
        {
            throw new InvalidDataException("The artifact has invalid fields.");
        }

        var path = Path.GetFullPath(Path.Combine(releaseDirectory, fileName));
        if (Path.GetDirectoryName(path) != releaseDirectory)
        {
            throw new InvalidDataException("The artifact lies outside the release directory.");
        }

        var file = new FileInfo(path);
        if (!file.Exists || file.Length != sizeBytes)
        {
            throw new InvalidDataException("The artifact is missing or does not have the declared size.");
        }

        return path;
    }

    private static bool IsSha256([NotNullWhen(true)] string? value) =>
        value is { Length: 64 } && value.All(char.IsAsciiHexDigitLower);
}
