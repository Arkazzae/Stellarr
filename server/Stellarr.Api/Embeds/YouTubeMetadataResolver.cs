using System.Text.Json;
using Microsoft.Extensions.Options;
using Stellarr.Api.Logging;

namespace Stellarr.Api.Embeds;

public interface IYouTubeMetadataResolver
{
    /// <summary>Reads what YouTube itself says about a video whose id has already been validated.</summary>
    Task<PageCard?> FetchAsync(VideoLink video, CancellationToken cancellationToken);
}

/// <summary>
/// Resolves the title and thumbnail of a YouTube video through YouTube's oEmbed endpoint.
/// </summary>
/// <remarks>
/// It neither scrapes the watch page nor requests the link as pasted.
/// <see cref="VideoLinks"/> has already proved that the link is a supported
/// YouTube URL and taken the id out of it, and this builds a canonical address
/// from that id alone. Recognising the video therefore never depends on this
/// optional request succeeding, and reading the page as generic OpenGraph, which
/// once turned real videos into blank players, is not an option.
/// </remarks>
public sealed class YouTubeMetadataResolver(
    HttpClient client,
    IOptions<EmbedOptions> options,
    ILogger<YouTubeMetadataResolver> logger) : IYouTubeMetadataResolver
{
    private const int MaxResponseBytes = 64 * 1024;
    private const int MaxTitleLength = 200;
    private const int MaxThumbnailUrlLength = 2_048;

    public async Task<PageCard?> FetchAsync(VideoLink video, CancellationToken cancellationToken)
    {
        if (video.Provider != VideoLinks.YouTube)
        {
            return null;
        }

        var watchPage = $"https://www.youtube.com/watch?v={Uri.EscapeDataString(video.Id)}";
        var endpoint = new Uri($"https://www.youtube.com/oembed?url={Uri.EscapeDataString(watchPage)}&format=json");
        try
        {
            // One deadline for the request and for reading the small response.
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, options.Value.TimeoutSeconds)));

            using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (!response.IsSuccessStatusCode ||
                !string.Equals(response.Content.Headers.ContentType?.MediaType, "application/json", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var bytes = await CappedBody.ReadAsync(response.Content, MaxResponseBytes, allowTruncated: false, deadline.Token);
            return bytes is null ? null : Parse(bytes, video.Id);
        }
        catch (Exception exception) when (
            exception is HttpRequestException or OperationCanceledException or InvalidOperationException or JsonException)
        {
            // Optional metadata: the video is a player with or without it.
            EmbedLog.FetchFailed(logger, exception, endpoint);
            return null;
        }
    }

    /// <summary>
    /// Keeps the title and thumbnail of the response and nothing else: the
    /// iframe markup it carries never enters the domain model. Null when the
    /// document is not YouTube's description of a video, or has neither.
    /// </summary>
    /// <exception cref="JsonException">The document is not JSON.</exception>
    /// <exception cref="InvalidOperationException">The document is JSON but not an object.</exception>
    public static PageCard? Parse(ReadOnlyMemory<byte> json, string expectedVideoId)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (!string.Equals(StringProperty(root, "type"), "video", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(StringProperty(root, "provider_name"), "YouTube", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var title = OpenGraph.CleanText(StringProperty(root, "title"), MaxTitleLength);
        var thumbnail = TrustedThumbnail(
            OpenGraph.CleanText(StringProperty(root, "thumbnail_url"), MaxThumbnailUrlLength),
            expectedVideoId);
        return title is null && thumbnail is null ? null : new PageCard(title, null, thumbnail);
    }

    private static string? StringProperty(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    /// <summary>
    /// The thumbnail only when it is on YouTube's own image hosts and belongs
    /// to this very video, so that a response cannot point the unfurler anywhere else.
    /// </summary>
    private static string? TrustedThumbnail(string? value, string videoId)
    {
        if (value is null ||
            !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !(uri.Host.Equals("i.ytimg.com", StringComparison.OrdinalIgnoreCase) ||
              uri.Host.Equals("img.youtube.com", StringComparison.OrdinalIgnoreCase)))
        {
            return null;
        }

        var path = uri.AbsolutePath;
        return path.StartsWith($"/vi/{videoId}/", StringComparison.Ordinal) ||
            path.StartsWith($"/vi_webp/{videoId}/", StringComparison.Ordinal)
            ? uri.ToString()
            : null;
    }
}
