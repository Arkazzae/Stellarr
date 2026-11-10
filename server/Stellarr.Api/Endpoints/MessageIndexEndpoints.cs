using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Messaging;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Finding things in a channel: a text search over everything that is part of
/// a message, and the pages of its media and links.
/// </summary>
public static class MessageIndexEndpoints
{
    private const int SearchResultCount = 50;
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;
    private const int MinQueryLength = 2;
    private const int MaxQueryLength = 200;

    private const string QueryLengthMessage = "Wyszukiwana fraza musi mieć od 2 do 200 znaków.";

    public static IEndpointRouteBuilder MapMessageIndexEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapGet("/channels/{channelId:guid}/messages/search", SearchAsync);
        api.MapGet("/channels/{channelId:guid}/messages/index", PageAsync);
        return endpoints;
    }

    /// <summary>The best matches in the channel, one page and no more.</summary>
    private static async Task<IResult> SearchAsync(
        Guid channelId,
        string? query,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var needle = query?.Trim() ?? "";
        if (needle.Length is < MinQueryLength or > MaxQueryLength)
        {
            return Invalid("query", QueryLengthMessage);
        }

        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        var found = await MessageSearchIndex.ReadAsync(
            db,
            channelId,
            MessageIndexKind.All,
            needle,
            snapshot: DateTime.UtcNow,
            offset: 0,
            SearchResultCount,
            cancellationToken);
        var viewerId = http.User.RequireUserId();
        var messages = await LoadInOrderAsync(db, found.MessageIds, cancellationToken);
        return Results.Ok(messages.Select(x => x.ToDto(viewerId)).ToArray());
    }

    /// <summary>
    /// Pages through the channel's messages, all of them, only those with
    /// attachments, or only those with links, optionally narrowed by a text.
    /// The first page fixes the moment the result is read as of, so messages
    /// that arrive while the reader pages cannot shift what is still to come.
    /// </summary>
    private static async Task<IResult> PageAsync(
        Guid channelId,
        string? kind,
        string? query,
        string? cursor,
        int? limit,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (limit is < 1 or > MaxPageSize)
        {
            return Invalid("limit", $"Limit musi mieścić się w zakresie 1–{MaxPageSize}.");
        }

        if (!TryParseKind(kind, out var indexKind))
        {
            return Invalid("kind", "Rodzaj indeksu musi mieć wartość all, media albo links.");
        }

        var needle = string.IsNullOrWhiteSpace(query) ? null : query.Trim();
        if (needle is { Length: < MinQueryLength or > MaxQueryLength })
        {
            return Invalid("query", QueryLengthMessage);
        }

        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        var queryHash = HashOf(needle);
        IndexCursor page;
        if (cursor is null)
        {
            page = new IndexCursor(channelId, DateTime.UtcNow, 0, indexKind, queryHash);
        }
        else if (!IndexCursor.TryDecode(cursor, out page) ||
                 page.ChannelId != channelId ||
                 page.Kind != indexKind ||
                 page.QueryHash != queryHash)
        {
            // A cursor says where in one result it stands, so it means
            // nothing next to another channel, kind or text.
            return Invalid("cursor", "Kursor indeksu wiadomości jest nieprawidłowy.");
        }

        var found = await MessageSearchIndex.ReadAsync(
            db,
            channelId,
            indexKind,
            needle,
            page.Snapshot,
            page.Offset,
            limit ?? DefaultPageSize,
            cancellationToken);
        var viewerId = http.User.RequireUserId();
        var messages = await LoadInOrderAsync(db, found.MessageIds, cancellationToken);
        return Results.Ok(new MessageIndexPageDto(
            messages.Select(x => x.ToDto(viewerId)).ToArray(),
            found.HasMore ? (page with { Offset = page.Offset + found.MessageIds.Count }).Encode() : null));
    }

    private static bool TryParseKind(string? name, out MessageIndexKind kind)
    {
        MessageIndexKind? parsed = name?.Trim().ToLowerInvariant() switch
        {
            null or "" or "all" => MessageIndexKind.All,
            "media" => MessageIndexKind.Media,
            "links" => MessageIndexKind.Links,
            _ => null,
        };
        kind = parsed.GetValueOrDefault();
        return parsed is not null;
    }

    /// <summary>The messages with the given ids, in that order; ids that no longer exist are skipped.</summary>
    private static async Task<Message[]> LoadInOrderAsync(
        AppDbContext db,
        IReadOnlyList<Guid> ids,
        CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        var byId = await db.Messages.AsNoTracking()
            .WithMessageDetails()
            .Where(x => ids.Contains(x.Id))
            .AsSplitQuery()
            .ToDictionaryAsync(x => x.Id, cancellationToken);
        return ids.Where(byId.ContainsKey).Select(id => byId[id]).ToArray();
    }

    private static ulong HashOf(string? query) =>
        BinaryPrimitives.ReadUInt64BigEndian(SHA256.HashData(Encoding.UTF8.GetBytes(query ?? "")));

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>
    /// Where a reader stands in one result: the moment it was read as of, how
    /// many messages have been delivered, and what the result is of (channel,
    /// kind and a hash of the text), which a later request must repeat.
    /// </summary>
    private readonly record struct IndexCursor(
        Guid ChannelId,
        DateTime Snapshot,
        int Offset,
        MessageIndexKind Kind,
        ulong QueryHash)
    {
        private const int ChannelIdSize = 16;
        private const int SnapshotAt = ChannelIdSize;
        private const int OffsetAt = SnapshotAt + sizeof(long);
        private const int KindAt = OffsetAt + sizeof(int);
        private const int QueryHashAt = KindAt + sizeof(byte);
        private const int Size = QueryHashAt + sizeof(ulong);

        public string Encode()
        {
            Span<byte> bytes = stackalloc byte[Size];
            ChannelId.TryWriteBytes(bytes);
            BinaryPrimitives.WriteInt64BigEndian(bytes[SnapshotAt..], Snapshot.Ticks);
            BinaryPrimitives.WriteInt32BigEndian(bytes[OffsetAt..], Offset);
            bytes[KindAt] = (byte)Kind;
            BinaryPrimitives.WriteUInt64BigEndian(bytes[QueryHashAt..], QueryHash);
            return Base64Url.EncodeToString(bytes);
        }

        public static bool TryDecode(string encoded, out IndexCursor cursor)
        {
            cursor = default;
            if (!Base64Url.IsValid(encoded, out var decodedLength) || decodedLength != Size)
            {
                return false;
            }

            Span<byte> bytes = stackalloc byte[Size];
            Base64Url.DecodeFromChars(encoded, bytes);

            var ticks = BinaryPrimitives.ReadInt64BigEndian(bytes[SnapshotAt..]);
            var offset = BinaryPrimitives.ReadInt32BigEndian(bytes[OffsetAt..]);
            var kind = (MessageIndexKind)bytes[KindAt];
            if (ticks < 0 || ticks > DateTime.MaxValue.Ticks || offset < 0 || !Enum.IsDefined(kind))
            {
                return false;
            }

            cursor = new IndexCursor(
                new Guid(bytes[..ChannelIdSize]),
                new DateTime(ticks, DateTimeKind.Utc),
                offset,
                kind,
                BinaryPrimitives.ReadUInt64BigEndian(bytes[QueryHashAt..]));
            return true;
        }
    }
}
