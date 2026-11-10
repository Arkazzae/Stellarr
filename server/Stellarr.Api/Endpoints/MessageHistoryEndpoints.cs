using System.Buffers.Binary;
using System.Buffers.Text;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Messaging;

namespace Stellarr.Api.Endpoints;

/// <summary>Reads a channel's transcript back, page by page.</summary>
public static class MessageHistoryEndpoints
{
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;

    public static IEndpointRouteBuilder MapMessageHistoryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>()
            .MapGet("/channels/{channelId:guid}/messages", GetHistoryAsync);
        return endpoints;
    }

    private static async Task<IResult> GetHistoryAsync(
        Guid channelId,
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

        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        // A first request freezes the result set at the moment it was made.
        // Messages that arrive while the reader pages back therefore cannot
        // shift the offsets and make an older row be skipped or shown twice.
        PageCursor page;
        if (cursor is null)
        {
            page = new PageCursor(channelId, DateTime.UtcNow, 0);
        }
        else if (!PageCursor.TryDecode(cursor, out page) || page.ChannelId != channelId)
        {
            return Invalid("cursor", "Kursor historii wiadomości jest nieprawidłowy.");
        }

        var pageSize = limit ?? DefaultPageSize;
        // One snapshot for both reads, so the journal position matches the rows.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var syncSequence = await db.MessageChanges.AsNoTracking()
            .Where(x => x.ChannelId == channelId)
            .MaxAsync(x => (long?)x.Sequence, cancellationToken) ?? 0;
        var rows = await db.Messages.AsNoTracking()
            .WithMessageDetails()
            .Where(x => x.ChannelId == channelId && x.CreatedAt <= page.Snapshot)
            .OrderByDescending(x => x.CreatedAt)
            .ThenByDescending(x => x.Id)
            .Skip(page.Offset)
            .Take(pageSize + 1)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var hasMore = rows.Count > pageSize;
        var viewerId = http.User.RequireUserId();
        var messages = rows.Take(pageSize).Reverse().Select(x => x.ToDto(viewerId)).ToArray();
        return Results.Ok(new MessageHistoryPageDto(
            messages,
            hasMore ? (page with { Offset = page.Offset + pageSize }).Encode() : null,
            syncSequence.ToString(CultureInfo.InvariantCulture)));
    }

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>
    /// Where a reader is in a channel's history: the moment the first page
    /// was requested, and how many messages before it have been delivered.
    /// </summary>
    private readonly record struct PageCursor(Guid ChannelId, DateTime Snapshot, int Offset)
    {
        private const int ChannelIdSize = 16;
        private const int Size = ChannelIdSize + sizeof(long) + sizeof(int);

        public string Encode()
        {
            Span<byte> bytes = stackalloc byte[Size];
            ChannelId.TryWriteBytes(bytes);
            BinaryPrimitives.WriteInt64BigEndian(bytes[ChannelIdSize..], Snapshot.Ticks);
            BinaryPrimitives.WriteInt32BigEndian(bytes[(ChannelIdSize + sizeof(long))..], Offset);
            return Base64Url.EncodeToString(bytes);
        }

        public static bool TryDecode(string encoded, out PageCursor cursor)
        {
            cursor = default;
            if (!Base64Url.IsValid(encoded, out var decodedLength) || decodedLength != Size)
            {
                return false;
            }

            Span<byte> bytes = stackalloc byte[Size];
            Base64Url.DecodeFromChars(encoded, bytes);

            var ticks = BinaryPrimitives.ReadInt64BigEndian(bytes[ChannelIdSize..]);
            var offset = BinaryPrimitives.ReadInt32BigEndian(bytes[(ChannelIdSize + sizeof(long))..]);
            if (ticks < 0 || ticks > DateTime.MaxValue.Ticks || offset < 0)
            {
                return false;
            }

            cursor = new PageCursor(
                new Guid(bytes[..ChannelIdSize]),
                new DateTime(ticks, DateTimeKind.Utc),
                offset);
            return true;
        }
    }
}
