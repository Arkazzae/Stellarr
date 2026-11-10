using System.Text.RegularExpressions;

namespace Stellarr.Api.Embeds;

/// <summary>Finds the links in a message body.</summary>
/// <remarks>
/// Follows the rules the web client autolinks by (<c>web/src/components/room/parts.ts</c>):
/// http and https only, a link runs to the next whitespace or character that
/// cannot stand in a URL, and punctuation at its end belongs to the sentence.
/// If the two disagreed, the transcript would show a link the server never
/// unfurls, or a card for text the reader cannot click.
/// </remarks>
public static partial class LinkExtractor
{
    private const string SentencePunctuation = ".,;:!?…'\"";

    [GeneratedRegex("""https?://[^\s<>"'`]+""", RegexOptions.IgnoreCase)]
    private static partial Regex Candidate();

    /// <summary>
    /// The first <paramref name="limit"/> distinct links of <paramref name="content"/>,
    /// in reading order. Two spellings of one page are two links: deciding that
    /// they are the same means normalising somebody else's URL, which is a guess.
    /// </summary>
    public static IReadOnlyList<Uri> Extract(string content, int limit)
    {
        List<Uri> links = [];
        if (limit <= 0)
        {
            return links;
        }

        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (var match in Candidate().EnumerateMatches(content))
        {
            var text = TrimTrailing(content.AsSpan(match.Index, match.Length)).ToString();

            // Something that looks like a link can still fail to parse, with
            // control characters in the host for one. That is text.
            if (seen.Add(text) &&
                Uri.TryCreate(text, UriKind.Absolute, out var link) &&
                (link.Scheme == Uri.UriSchemeHttp || link.Scheme == Uri.UriSchemeHttps))
            {
                links.Add(link);
                if (links.Count == limit)
                {
                    break;
                }
            }
        }

        return links;
    }

    /// <summary>The host as a reader knows it: lower case, without a leading "www.".</summary>
    internal static string DomainOf(Uri link)
    {
        var host = link.Host.ToLowerInvariant();
        return host.StartsWith("www.", StringComparison.Ordinal) ? host[4..] : host;
    }

    private static ReadOnlySpan<char> TrimTrailing(ReadOnlySpan<char> run)
    {
        while (run.Length > 0)
        {
            var last = run[^1];
            if (!SentencePunctuation.Contains(last) && !IsUnopenedBracket(run, last))
            {
                break;
            }

            run = run[..^1];
        }

        return run;
    }

    /// <summary>
    /// A closing bracket belongs to the link only when the link opened it, so
    /// "(see https://x/a)" leaves the parenthesis out and "https://x/a_(b)"
    /// keeps it.
    /// </summary>
    private static bool IsUnopenedBracket(ReadOnlySpan<char> run, char last)
    {
        var opening = last switch
        {
            ')' => '(',
            ']' => '[',
            _ => '\0',
        };
        return opening != '\0' && run.Count(last) > run.Count(opening);
    }
}
