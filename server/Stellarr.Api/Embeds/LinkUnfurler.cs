using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Options;
using Stellarr.Api.Logging;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Embeds;

public sealed record FetchedImage(byte[] Bytes, string ContentType, string FileName);

public interface ILinkUnfurler
{
    /// <summary>Reads what a page says about itself, or null when it cannot or will not be read.</summary>
    Task<PageCard?> FetchCardAsync(Uri url, CancellationToken cancellationToken);

    /// <summary>Downloads a preview image, so that this server can serve it itself.</summary>
    Task<FetchedImage?> FetchImageAsync(Uri url, CancellationToken cancellationToken);
}

/// <summary>
/// Fetches other people's pages on behalf of a message.
/// </summary>
/// <remarks>
/// A timeout, a 404, a login wall and an image that is really a 40 MB TIFF all
/// end in "no card". A preview is decoration, and decoration must not be able
/// to fail a send or hold one up.
/// </remarks>
public sealed class LinkUnfurler(
    HttpClient client,
    IOptions<EmbedOptions> options,
    ILogger<LinkUnfurler> logger) : ILinkUnfurler
{
    private static readonly string[] PageTypes = ["text/html", "application/xhtml+xml"];

    private readonly EmbedOptions _options = options.Value;

    public async Task<PageCard?> FetchCardAsync(Uri url, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(url, cancellationToken);
        if (response?.Content.Headers.ContentType is not { MediaType: { } mediaType } contentType ||
            !PageTypes.Contains(mediaType, StringComparer.OrdinalIgnoreCase))
        {
            return null;
        }

        // A page that outgrows the cap while it streams is still read as far
        // as the cap: what a card needs is in the head, and the head comes
        // first. One that announces a size over the cap is not read at all.
        if (await CappedBody.ReadAsync(response.Content, _options.MaxHtmlBytes, allowTruncated: true, cancellationToken)
            is not { } bytes)
        {
            return null;
        }

        // Relative addresses resolve against where the redirects ended, not
        // against the link as it was posted.
        return OpenGraph.Parse(Decode(bytes, contentType), response.RequestMessage?.RequestUri ?? url);
    }

    public async Task<FetchedImage?> FetchImageAsync(Uri url, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(url, cancellationToken);
        if (response?.Content.Headers.ContentType?.MediaType?.ToLowerInvariant() is not { } mediaType ||
            !ImageValidation.IsAllowedContentType(mediaType))
        {
            return null;
        }

        // Half an image is not an image, so one over the cap is dropped and not
        // stored cut short.
        if (await CappedBody.ReadAsync(response.Content, _options.MaxImageBytes, allowTruncated: false, cancellationToken)
            is not { Length: > 0 } bytes)
        {
            return null;
        }

        // The bytes also have to be what the header claims, as for a file a
        // member uploads: this one comes from a stranger and is about to be
        // served from our origin.
        return ImageValidation.MatchesSignature(mediaType, bytes)
            ? new FetchedImage(bytes, mediaType, "preview" + ImageValidation.ExtensionFor(mediaType))
            : null;
    }

    /// <summary>
    /// Requests <paramref name="url"/> and returns the response when it is a
    /// success, else null.
    /// </summary>
    /// <remarks>
    /// The deadline ends with the headers; the body is read under the caller's
    /// token alone.
    /// </remarks>
    private async Task<HttpResponseMessage?> SendAsync(Uri url, CancellationToken cancellationToken)
    {
        if (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps)
        {
            return null;
        }

        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (response.IsSuccessStatusCode)
            {
                return response;
            }

            response.Dispose();
            return null;
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or InvalidOperationException)
        {
            // This includes the address check's refusal, which surfaces as a
            // failed connect. Nobody asked for a report, only pasted a link.
            EmbedLog.FetchFailed(logger, exception, url);
            return null;
        }
    }

    /// <summary>
    /// Decodes a page in the charset it declares. A name this runtime does not
    /// know, which includes every legacy code page, reads as UTF-8.
    /// </summary>
    private static string Decode(byte[] bytes, MediaTypeHeaderValue contentType)
    {
        var charset = contentType.CharSet?.Trim('"', '\'');
        if (!string.IsNullOrEmpty(charset))
        {
            try
            {
                return Encoding.GetEncoding(charset).GetString(bytes);
            }
            catch (ArgumentException)
            {
                // Unknown to this runtime; UTF-8 below.
            }
        }

        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>
    /// Builds the handler that keeps the unfurler on the public internet.
    /// </summary>
    /// <remarks>
    /// The check is in <c>ConnectCallback</c> and not in front of the request:
    /// the name is resolved once and the socket is opened to one of the
    /// addresses that passed, so a host that answers with a public address the
    /// first time and a private one the second (DNS rebinding) never gets a
    /// connection. Redirects connect through the same callback, so every hop
    /// is checked and not only the link somebody typed.
    /// </remarks>
    public static SocketsHttpHandler CreateHandler(EmbedOptions options) => new()
    {
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = Math.Max(1, options.MaxRedirects),
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(Math.Max(1, options.TimeoutSeconds)),
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),

        // Nothing fetched here is ours, so nothing fetched here sets state.
        UseCookies = false,
        ConnectCallback = (context, cancellationToken) => ConnectAsync(options, context, cancellationToken),
    };

    private static async ValueTask<Stream> ConnectAsync(
        EmbedOptions options,
        SocketsHttpConnectionContext context,
        CancellationToken cancellationToken)
    {
        var host = context.DnsEndPoint.Host;
        var resolved = await Dns.GetHostAddressesAsync(host, cancellationToken);
        var allowed = options.AllowPrivateNetworks ? resolved : resolved.Where(PublicAddress.IsPublic).ToArray();
        if (allowed.Length == 0)
        {
            throw new HttpRequestException($"Refusing to connect to {host}: it has no public address.");
        }

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(allowed, context.DnsEndPoint.Port, cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}

/// <summary>Reads a response body without trusting the far end to keep to a size.</summary>
internal static class CappedBody
{
    private const int ChunkBytes = 16 * 1024;

    /// <summary>
    /// Reads at most <paramref name="limit"/> bytes, whatever <c>Content-Length</c>
    /// says: a header is a promise and not a bound.
    /// </summary>
    /// <returns>
    /// The bytes, or null when the body announces more than the limit or, unless
    /// <paramref name="allowTruncated"/>, turns out to have more.
    /// </returns>
    internal static async Task<byte[]?> ReadAsync(
        HttpContent content,
        int limit,
        bool allowTruncated,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength > limit)
        {
            return null;
        }

        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var body = new MemoryStream();
        var chunk = new byte[ChunkBytes];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken);
            if (read == 0)
            {
                return body.ToArray();
            }

            var room = limit - (int)body.Length;
            if (read > room)
            {
                if (!allowTruncated)
                {
                    return null;
                }

                body.Write(chunk.AsSpan(0, room));
                return body.ToArray();
            }

            body.Write(chunk.AsSpan(0, read));
        }
    }
}
