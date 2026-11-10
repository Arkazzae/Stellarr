using Stellarr.Api.Contracts;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The Android APK. Signing material stays on the build host and never
/// reaches the data volume or the application image.
/// </summary>
public sealed class AndroidReleaseCatalogue(IConfiguration configuration) : ClientReleaseCatalogue(
    configuration,
    new ClientReleaseKind(
        DirectoryName: "android",
        ManifestFileName: "android-release.json",
        Platform: "android",
        Architecture: "arm64-v8a",
        DownloadPath: AndroidReleaseEndpoints.ApkDownloadPath,
        ContentType: "application/vnd.android.package-archive",
        Unavailable: MessageKey.AndroidReleaseUnavailable));

public static class AndroidReleaseEndpoints
{
    public const string ApkDownloadPath = "/api/android/release/apk";

    public static IEndpointRouteBuilder MapAndroidReleaseEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/android/release",
            (HttpContext http, AndroidReleaseCatalogue catalogue, Messages messages) =>
                ClientReleaseResults.Describe(http, catalogue, messages));
        endpoints.MapGet(
            ApkDownloadPath,
            (HttpContext http, AndroidReleaseCatalogue catalogue, Messages messages) =>
                ClientReleaseResults.Download(http, catalogue, messages));
        endpoints.MapGet("/api/client/releases", ListReleases);
        return endpoints;
    }

    /// <summary>
    /// Every release on offer, the Android one first. A broken manifest hides
    /// only its own platform, so that people can still download the other one;
    /// the list is unavailable when nothing could be read at all.
    /// </summary>
    private static IResult ListReleases(
        HttpContext http,
        AndroidReleaseCatalogue android,
        DesktopReleaseCatalogue desktop,
        Messages messages)
    {
        var releases = new List<ClientReleaseDto>(2);
        var anyBroken = false;
        foreach (var catalogue in (ClientReleaseCatalogue[])[android, desktop])
        {
            try
            {
                if (catalogue.Current() is { } release)
                {
                    releases.Add(release.ToDto());
                }
            }
            catch (InvalidDataException)
            {
                anyBroken = true;
            }
        }

        if (releases.Count == 0 && anyBroken)
        {
            return ClientReleaseResults.Unavailable(messages, MessageKey.ReleaseListUnavailable);
        }

        http.Response.Headers.CacheControl = ClientReleaseResults.CacheControl;
        return Results.Ok(releases);
    }
}
