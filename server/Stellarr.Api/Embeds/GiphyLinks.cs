using System.Diagnostics.CodeAnalysis;

namespace Stellarr.Api.Embeds;

/// <summary>Recognises the canonical page of a GIPHY GIF without touching the network.</summary>
/// <remarks>
/// GIPHY requires that its API and media are requested by the viewer's own
/// client, and forbids partners from caching its media. The link therefore
/// stays in the message as written, and the server neither unfurls nor copies it.
/// </remarks>
public static class GiphyLinks
{
    public static bool TryParse(Uri uri, [NotNullWhen(true)] out string? id)
    {
        id = null;
        if (uri.Scheme != Uri.UriSchemeHttps || LinkExtractor.DomainOf(uri) != "giphy.com")
        {
            return false;
        }

        // /gifs/<slug>, where the slug is "some-words-<id>" or just "<id>".
        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments is not ["gifs", var slug])
        {
            return false;
        }

        var candidate = slug[(slug.LastIndexOf('-') + 1)..];
        if (candidate.Length == 0 || !candidate.All(char.IsAsciiLetterOrDigit))
        {
            return false;
        }

        id = candidate;
        return true;
    }
}
