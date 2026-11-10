using System.Collections.Frozen;
using System.Net;

namespace Stellarr.Api.Embeds;

/// <summary>What a page says about itself.</summary>
public sealed record PageCard(string? Title, string? Description, string? ImageUrl);

/// <summary>Reads the few <c>&lt;meta&gt;</c> tags that make a link card.</summary>
/// <remarks>
/// A tag scanner and not an HTML parser, which caps what a hostile page can ask
/// of this code: no tree is built, nothing is executed or followed, and every
/// value that comes out is plain text. The scan is a single pass, so a page made
/// of unfinished tags costs time in proportion to its size and no more.
/// </remarks>
public static class OpenGraph
{
    private const int MaxTitle = 200;
    private const int MaxDescription = 400;

    /// <summary>The longest <c>&lt;title&gt;</c> text that counts; a longer element is not read as a title.</summary>
    private const int MaxTitleElement = 400;

    private static readonly FrozenSet<string> Wanted = new[]
    {
        "og:title", "twitter:title",
        "og:description", "twitter:description", "description",
        "og:image", "twitter:image",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static PageCard Parse(string html, Uri pageUrl)
    {
        // Everything after the head is body copy, which anyone can put tags in.
        var head = html[..HeadEnd(html)];

        // The first tag that names a wanted key wins, whatever it says: an
        // empty og:title is the page's answer and the title element is not
        // asked after it.
        Dictionary<string, string> meta = [];
        foreach (var (key, content) in MetaTags(head))
        {
            if (Wanted.Contains(key))
            {
                meta.TryAdd(key, content);
            }
        }

        var title = First(meta, "og:title", "twitter:title") ?? TitleElement(head);
        var description = First(meta, "og:description", "twitter:description", "description");
        var image = First(meta, "og:image", "twitter:image");

        return new PageCard(
            CleanText(title, MaxTitle),
            CleanText(description, MaxDescription),
            AbsoluteWebAddress(image, pageUrl));
    }

    /// <summary>
    /// Decodes entities, collapses whitespace and cuts to <paramref name="limit"/>
    /// characters. What comes out is text and is stored and shown as text.
    /// </summary>
    internal static string? CleanText(string? value, int limit)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var words = WebUtility.HtmlDecode(value).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var text = string.Join(' ', words);
        if (text.Length <= limit)
        {
            return text.Length == 0 ? null : text;
        }

        // A cut between the halves of a surrogate pair would leave a character
        // that cannot be written to JSON.
        var cut = char.IsHighSurrogate(text[limit - 1]) ? limit - 1 : limit;
        return text[..cut].TrimEnd() + "…";
    }

    private static string? First(Dictionary<string, string> meta, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (meta.TryGetValue(key, out var value))
            {
                return value;
            }
        }

        return null;
    }

    /// <summary>Where the head ends: at the first <c>&lt;/head&gt;</c>, closing bracket included, or the end of the page.</summary>
    private static int HeadEnd(string html)
    {
        const string close = "</head";
        var from = 0;
        while (html.IndexOf(close, from, StringComparison.OrdinalIgnoreCase) is var start and >= 0)
        {
            var position = start + close.Length;
            while (position < html.Length && char.IsWhiteSpace(html[position]))
            {
                position++;
            }

            if (position < html.Length && html[position] == '>')
            {
                return start;
            }

            from = start + 1;
        }

        return html.Length;
    }

    /// <summary>
    /// The name and content of every <c>&lt;meta&gt;</c> tag, the name being
    /// its <c>property</c>, <c>name</c> or <c>itemprop</c>.
    /// </summary>
    /// <remarks>
    /// A tag runs to the first <c>&gt;</c>, quoted or not, so a value with a
    /// bracket in it is cut off and the tag says nothing.
    /// </remarks>
    private static List<(string Key, string Content)> MetaTags(string head)
    {
        const string open = "<meta";
        List<(string, string)> tags = [];
        var position = 0;
        while (head.IndexOf(open, position, StringComparison.OrdinalIgnoreCase) is var start and >= 0)
        {
            var afterName = start + open.Length;
            position = afterName;
            if (afterName >= head.Length || !char.IsWhiteSpace(head[afterName]))
            {
                continue;
            }

            var end = head.IndexOf('>', afterName);
            if (end < 0)
            {
                // No bracket left anywhere after this point, so no tag either.
                break;
            }

            position = end + 1;
            string? key = null;
            string? content = null;
            foreach (var (name, value) in Attributes(head.AsSpan(start, end - start)))
            {
                if (name is "property" or "name" or "itemprop")
                {
                    key ??= value.Trim().ToLowerInvariant();
                }
                else if (name == "content")
                {
                    content ??= value;
                }
            }

            if (key is not null && content is not null)
            {
                tags.Add((Canonical(key), content));
            }
        }

        return tags;
    }

    /// <summary>The names for one thing that pages use interchangeably.</summary>
    private static string Canonical(string key) => key switch
    {
        "og:image:url" or "og:image:secure_url" => "og:image",
        "twitter:image:src" => "twitter:image",
        _ => key,
    };

    /// <summary>
    /// The <c>name=value</c> pairs of a tag, names in lower case. A name is
    /// letters, colons, underscores and hyphens; a value is quoted with either
    /// kind of quote or bare. What is neither, such as an attribute whose quote
    /// is never closed, is skipped over.
    /// </summary>
    private static List<(string Name, string Value)> Attributes(ReadOnlySpan<char> tag)
    {
        List<(string, string)> attributes = [];
        var position = 0;
        while (position < tag.Length)
        {
            if (!IsNameCharacter(tag[position]))
            {
                position++;
                continue;
            }

            var nameEnd = position;
            while (nameEnd < tag.Length && IsNameCharacter(tag[nameEnd]))
            {
                nameEnd++;
            }

            var cursor = SkipWhitespace(tag, nameEnd);
            if (cursor >= tag.Length || tag[cursor] != '=' ||
                !TryReadValue(tag, SkipWhitespace(tag, cursor + 1), out var value, out var valueEnd))
            {
                position = nameEnd;
                continue;
            }

            attributes.Add((tag[position..nameEnd].ToString().ToLowerInvariant(), value));
            position = valueEnd;
        }

        return attributes;
    }

    private static bool IsNameCharacter(char character) =>
        char.IsAsciiLetter(character) || character is ':' or '_' or '-';

    private static int SkipWhitespace(ReadOnlySpan<char> text, int position)
    {
        while (position < text.Length && char.IsWhiteSpace(text[position]))
        {
            position++;
        }

        return position;
    }

    private static bool TryReadValue(ReadOnlySpan<char> tag, int start, out string value, out int end)
    {
        value = string.Empty;
        end = start;
        if (start >= tag.Length)
        {
            return false;
        }

        var quote = tag[start];
        if (quote is '"' or '\'')
        {
            var length = tag[(start + 1)..].IndexOf(quote);
            if (length >= 0)
            {
                value = tag.Slice(start + 1, length).ToString();
                end = start + 1 + length + 1;
                return true;
            }

            // A double quote that is never closed starts no value; a single
            // one is only an ordinary character of a bare value.
            if (quote == '"')
            {
                return false;
            }
        }

        end = start;
        while (end < tag.Length && !char.IsWhiteSpace(tag[end]) && tag[end] != '"')
        {
            end++;
        }

        value = tag[start..end].ToString();
        return true;
    }

    /// <summary>
    /// The text of the first <c>&lt;title&gt;</c> element, when it is closed
    /// within <see cref="MaxTitleElement"/> characters of its opening tag.
    /// </summary>
    private static string? TitleElement(string head)
    {
        const string open = "<title";
        const string close = "</title>";
        var position = 0;
        var bracket = -1;
        while (head.IndexOf(open, position, StringComparison.OrdinalIgnoreCase) is var start and >= 0)
        {
            position = start + open.Length;
            if (bracket < position)
            {
                bracket = head.IndexOf('>', position);
                if (bracket < 0)
                {
                    return null;
                }
            }

            var textStart = bracket + 1;
            var window = head.AsSpan(textStart, Math.Min(MaxTitleElement + close.Length, head.Length - textStart));
            var length = window.IndexOf(close, StringComparison.OrdinalIgnoreCase);
            if (length >= 0)
            {
                return head.Substring(textStart, length);
            }
        }

        return null;
    }

    /// <summary>
    /// Resolves an image address against the page. Anything that is not http or
    /// https once resolved, such as <c>data:</c> or <c>javascript:</c>, is dropped.
    /// </summary>
    private static string? AbsoluteWebAddress(string? value, Uri pageUrl)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            !Uri.TryCreate(pageUrl, WebUtility.HtmlDecode(value).Trim(), out var address))
        {
            return null;
        }

        return address.Scheme == Uri.UriSchemeHttp || address.Scheme == Uri.UriSchemeHttps
            ? address.ToString()
            : null;
    }
}
