using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Messaging;

namespace Stellarr.Api.Endpoints;

/// <summary>Reads a channel's transcript back, page by page, and what changed in it since.</summary>
public static class MessageHistoryEndpoints
{
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;
    private const int DefaultSyncPageSize = 200;
    private const int MaxSyncPageSize = 500;

    public static IEndpointRouteBuilder MapMessageHistoryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapGet("/channels/{channelId:guid}/messages", GetHistoryAsync);
        api.MapGet("/channels/{channelId:guid}/messages/sync", SyncAsync);
        return endpoints;
    }

    private static async Task<IResult> GetHistoryAsync(
        Guid channelId,
        string? cursor,
        int? limit,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (limit is < 1 or > MaxPageSize)
        {
            return Invalid("limit", messages.Get(MessageKey.PageLimitRange, ("max", MaxPageSize)));
        }

        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        // A first request freezes the result set at the moment it was made.
        // Messages that arrive while the reader pages back therefore cannot
        // shift the offsets and make an older row be skipped or shown twice.
        HistoryCursor page;
        if (cursor is null)
        {
            page = new HistoryCursor(channelId, DateTime.UtcNow, 0);
        }
        else if (!HistoryCursor.TryDecode(cursor, out page) || page.ScopeId != channelId)
        {
            return Invalid("cursor", messages.Get(MessageKey.HistoryCursorInvalid));
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
        var items = rows.Take(pageSize).Reverse().Select(x => x.ToDto(messages, viewerId)).ToArray();
        return Results.Ok(new MessageHistoryPageDto(
            items,
            hasMore ? (page with { Offset = page.Offset + pageSize }).Encode() : null,
            syncSequence.ToString(CultureInfo.InvariantCulture)));
    }

    /// <summary>
    /// What happened in the channel after a journal position, for a client
    /// that missed realtime events while it was disconnected. A change says
    /// only which message was touched, and an upsert is answered with the
    /// message as it is now, so replaying the page needs no ordering of edits.
    /// </summary>
    private static async Task<IResult> SyncAsync(
        Guid channelId,
        long? after,
        int? limit,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (after is < 0 || limit is < 1 or > MaxSyncPageSize)
        {
            return Invalid("cursor", messages.Get(MessageKey.SyncCursorInvalid));
        }

        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        var from = after ?? 0;
        var pageSize = limit ?? DefaultSyncPageSize;
        var rows = await db.MessageChanges.AsNoTracking()
            .Where(x => x.ChannelId == channelId && x.Sequence > from)
            .OrderBy(x => x.Sequence)
            .Take(pageSize + 1)
            .ToListAsync(cancellationToken);
        var changes = rows.Take(pageSize).ToArray();

        var touched = changes
            .Where(x => x.Kind == MessageChangeKind.Upsert)
            .Select(x => x.MessageId)
            .Distinct()
            .ToArray();
        var current = touched.Length == 0
            ? []
            : await db.Messages.AsNoTracking()
                .WithMessageDetails()
                .Where(x => touched.Contains(x.Id))
                .AsSplitQuery()
                .ToDictionaryAsync(x => x.Id, cancellationToken);

        var viewerId = http.User.RequireUserId();
        var dtos = changes.Select(change =>
        {
            // A message that was upserted and removed since has nothing left to show.
            var message = change.Kind == MessageChangeKind.Upsert ? current.GetValueOrDefault(change.MessageId) : null;
            return new MessageSyncChangeDto(
                change.Sequence.ToString(CultureInfo.InvariantCulture),
                message is null ? "delete" : "upsert",
                change.MessageId.ToString(),
                message?.ToDto(messages, viewerId));
        }).ToArray();
        var next = changes.Length == 0 ? from : changes[^1].Sequence;
        return Results.Ok(new MessageSyncPageDto(
            dtos,
            next.ToString(CultureInfo.InvariantCulture),
            rows.Count > pageSize,
            changes.Any(x => x.Kind == MessageChangeKind.Reset)));
    }

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
