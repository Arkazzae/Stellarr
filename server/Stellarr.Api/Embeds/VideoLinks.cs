using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Web;

namespace Stellarr.Api.Embeds;

/// <summary>A link the client can put a player behind, recognised from the URL alone.</summary>
public sealed record VideoLink(string Provider, string Id, int? StartSeconds);

/// <summary>Recognises the video hosts that can be embedded.</summary>
/// <remarks>
/// Nothing here makes a request. The id is in the URL and the viewer's own
/// client plays the video, so a player can be offered the moment a message is
/// posted, whether or not this server can reach the host. A title and a
/// thumbnail are fetched afterwards, if the host answers.
/// </remarks>
public static partial class VideoLinks
{
    public const string YouTube = "youtube";
    public const string Vimeo = "vimeo";

    private const int MaxStartSeconds = 24 * 60 * 60;

    /// <summary>Hours, minutes and seconds in any combination: <c>1h2m3s</c>, <c>90s</c> or <c>90</c>.</summary>
    [GeneratedRegex("^(?:(?<h>\\d+)h)?(?:(?<m>\\d+)m)?(?:(?<s>\\d+)s?)?$", RegexOptions.IgnoreCase)]
    private static partial Regex Timestamp();

    public static bool TryParse(Uri uri, [NotNullWhen(true)] out VideoLink? link)
    {
        link = null;
        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        (string? provider, string? id) = HostWithoutPrefix(uri.Host) switch
        {
            "youtube.com" or "youtube-nocookie.com" => (YouTube, YouTubeId(uri, segments)),
            "youtu.be" => (YouTube, segments.FirstOrDefault()),
            "vimeo.com" or "player.vimeo.com" => (Vimeo, VimeoId(segments)),
            _ => (null, null),
        };

        if (provider is null || id is null || !IsValidId(provider, id))
        {
            return false;
        }

        link = new VideoLink(provider, id, StartSeconds(uri));
        return true;
    }

    /// <summary>The host in lower case, without the "www." or "m." that only change the layout.</summary>
    private static string HostWithoutPrefix(string host)
    {
        var lower = host.ToLowerInvariant();
        if (lower.StartsWith("www.", StringComparison.Ordinal))
        {
            return lower[4..];
        }

        return lower.StartsWith("m.", StringComparison.Ordinal) ? lower[2..] : lower;
    }

    private static string? YouTubeId(Uri uri, string[] segments)
    {
        // /watch?v=ID is the canonical form. The path forms are what a phone's
        // share sheet pastes.
        if (segments is ["embed" or "shorts" or "live" or "v", var id, ..])
        {
            return id;
        }

        return HttpUtility.ParseQueryString(uri.Query)["v"];
    }

    private static string? VimeoId(string[] segments) => segments switch
    {
        // player.vimeo.com/video/ID, besides vimeo.com/ID.
        ["video", var id, ..] => id,
        [var id, ..] => id,
        _ => null,
    };

    private static bool IsValidId(string provider, string id) => provider == YouTube
        ? id.Length == 11 && id.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_')
        : id.Length is >= 6 and <= 12 && id.All(char.IsAsciiDigit);

    private static int? StartSeconds(Uri uri)
    {
        var query = HttpUtility.ParseQueryString(uri.Query);
        var fragment = uri.Fragment.TrimStart('#');
        var raw = query["t"] ?? query["start"] ??
            (fragment.StartsWith("t=", StringComparison.OrdinalIgnoreCase) ? fragment[2..] : null);
        if (string.IsNullOrEmpty(raw) || Timestamp().Match(raw) is not { Success: true } match)
        {
            return null;
        }

        var total = Part(match, "h") * 3600 + Part(match, "m") * 60 + Part(match, "s");

        // A deep link past a day is not one, and the cap keeps a hostile
        // value from reaching clients as anything to reason about.
        return total is > 0 and <= MaxStartSeconds ? total : null;
    }

    /// <summary>One count of a timestamp; one too large for an int counts as nothing.</summary>
    private static int Part(Match match, string group) =>
        int.TryParse(match.Groups[group].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            ? value
            : 0;
}
