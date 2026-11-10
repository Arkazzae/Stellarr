using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data;

/// <summary>Which messages of a channel an index read is about.</summary>
public enum MessageIndexKind
{
    All = 0,
    Media = 1,
    Links = 2,
}

/// <param name="HasMore">Whether the index holds messages beyond the page.</param>
public sealed record MessageIndexResult(IReadOnlyList<Guid> MessageIds, bool HasMore);

/// <summary>
/// Reads a channel's catalogue, the table and the FTS5 index that
/// <c>MessageIndexSchema</c> builds and its triggers keep current.
/// </summary>
public static partial class MessageSearchIndex
{
    private const int MaxTerms = 16;
    private const char LowerStrokeL = '\u0142';
    private const char UpperStrokeL = '\u0141';

    /// <summary>
    /// Turns what somebody typed into an FTS5 expression that cannot contain
    /// an operator of the syntax: every word is required and matches as a
    /// prefix, so "rap" finds "raport.pdf", and the punctuation of a URL does
    /// no harm. Null when there is no word in it.
    /// </summary>
    public static string? BuildQuery(string query)
    {
        var terms = Words().Matches(query)
            .Select(match => match.Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxTerms)
            .Select(PrefixTerm)
            .ToArray();
        return terms.Length == 0 ? null : string.Join(" AND ", terms);
    }

    /// <summary>
    /// A word as a prefix match. The tokenizer folds accented letters but not
    /// the Polish l with a stroke, which counts as a letter of its own, so a
    /// word is also searched with the two l letters exchanged: that is how a
    /// Polish word typed on a keyboard without Polish letters is still found.
    /// </summary>
    private static string PrefixTerm(string word)
    {
        var prefix = $"\"{word}\"*";
        return ExchangeL(word) is { } other ? $"({prefix} OR \"{other}\"*)" : prefix;
    }

    private static string? ExchangeL(string word)
    {
        if (word.Contains(LowerStrokeL) || word.Contains(UpperStrokeL))
        {
            return word.Replace(LowerStrokeL, 'l').Replace(UpperStrokeL, 'L');
        }

        return word.Contains('l') || word.Contains('L')
            ? word.Replace('l', LowerStrokeL).Replace('L', UpperStrokeL)
            : null;
    }

    /// <summary>
    /// One page of the channel's messages as of <paramref name="snapshot"/>.
    /// Without a query they come newest first, so that paging stays stable;
    /// with one, best match first. A query with no word in it matches nothing.
    /// </summary>
    public static async Task<MessageIndexResult> ReadAsync(
        AppDbContext db,
        Guid channelId,
        MessageIndexKind kind,
        string? query,
        DateTime snapshot,
        int offset,
        int limit,
        CancellationToken cancellationToken)
    {
        var match = query is null ? null : BuildQuery(query);
        if (query is not null && match is null)
        {
            return new MessageIndexResult([], false);
        }

        // One more than asked for, to learn whether there is a next page.
        var ids = match is null
            ? await ListNewestAsync(db, channelId, kind, snapshot, offset, limit + 1, cancellationToken)
            : await MatchAsync(db, channelId, kind, match, snapshot, offset, limit + 1, cancellationToken);
        return ids.Count > limit
            ? new MessageIndexResult(ids[..limit], HasMore: true)
            : new MessageIndexResult(ids, HasMore: false);
    }

    private static async Task<List<Guid>> ListNewestAsync(
        AppDbContext db,
        Guid channelId,
        MessageIndexKind kind,
        DateTime snapshot,
        int offset,
        int take,
        CancellationToken cancellationToken)
    {
        var entries = db.MessageIndexEntries.AsNoTracking()
            .Where(x => x.ChannelId == channelId && x.CreatedAt <= snapshot);
        // Compared with a value rather than tested bare: only an equality lets
        // SQLite read the index of the filter in order. A bare test would have
        // it sort every entry of the channel for each page.
        var present = true;
        entries = kind switch
        {
            MessageIndexKind.Media => entries.Where(x => x.HasAttachments == present),
            MessageIndexKind.Links => entries.Where(x => x.HasLinks == present),
            _ => entries,
        };
        return await entries
            .OrderByDescending(x => x.CreatedAt)
            .ThenByDescending(x => x.MessageId)
            .Skip(offset)
            .Take(take)
            .Select(x => x.MessageId)
            .ToListAsync(cancellationToken);
    }

    private static async Task<List<Guid>> MatchAsync(
        AppDbContext db,
        Guid channelId,
        MessageIndexKind kind,
        string match,
        DateTime snapshot,
        int offset,
        int take,
        CancellationToken cancellationToken)
    {
        var mediaOnly = kind == MessageIndexKind.Media;
        var linksOnly = kind == MessageIndexKind.Links;
        return await db.Database
            .SqlQuery<Guid>(
                $"""
                SELECT i."MessageId" AS "Value"
                FROM "MessageSearch"
                JOIN "MessageIndexEntries" i ON i.rowid = "MessageSearch".rowid
                WHERE "MessageSearch" MATCH {match}
                  AND i."ChannelId" = {channelId}
                  AND i."CreatedAt" <= {snapshot}
                  AND (NOT {mediaOnly} OR i."HasAttachments" = 1)
                  AND (NOT {linksOnly} OR i."HasLinks" = 1)
                ORDER BY bm25("MessageSearch"), i."CreatedAt" DESC, i."MessageId" DESC
                LIMIT {take} OFFSET {offset}
                """)
            .ToListAsync(cancellationToken);
    }

    [GeneratedRegex(@"[\p{L}\p{N}]+", RegexOptions.CultureInvariant)]
    private static partial Regex Words();
}
