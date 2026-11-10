using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Messaging;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The conversations of a channel. A thread has no row of its own: it exists
/// once a message points at a root through ReplyToMessageId, and replies are
/// flat, each one answering the root directly.
/// </summary>
public static class MessageThreadEndpoints
{
    public static IEndpointRouteBuilder MapMessageThreadEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapGet("/channels/{channelId:guid}/threads", ListAsync);
        api.MapGet("/channels/{channelId:guid}/threads/{rootId:guid}", ReadAsync);
        return endpoints;
    }

    /// <summary>Every thread of the channel, the most recently answered first.</summary>
    private static async Task<IResult> ListAsync(
        Guid channelId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        var threads = await db.Messages.AsNoTracking()
            .Where(x => x.ChannelId == channelId && x.ReplyToMessageId != null)
            .GroupBy(x => x.ReplyToMessageId!.Value)
            .Select(replies => new
            {
                RootId = replies.Key,
                ReplyCount = replies.Count(),
                LastReplyAt = replies.Max(x => x.CreatedAt),
            })
            .OrderByDescending(x => x.LastReplyAt)
            .ThenByDescending(x => x.RootId)
            .ToListAsync(cancellationToken);

        var rootIds = threads.Select(x => x.RootId).ToArray();
        var roots = await db.Messages.AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Attachments)
            .Where(x => rootIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, cancellationToken);
        return Results.Ok(threads
            .Where(x => roots.ContainsKey(x.RootId))
            .Select(x => new ThreadSummaryDto(
                channelId.ToString(),
                roots[x.RootId].ToReferenceDto(),
                x.ReplyCount,
                x.LastReplyAt.AsUtc()))
            .ToArray());
    }

    /// <summary>
    /// A thread in full, read on its own so that opening one does not depend
    /// on how far back the transcript has been loaded.
    /// </summary>
    private static async Task<IResult> ReadAsync(
        Guid channelId,
        Guid rootId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        var messages = await db.Messages.AsNoTracking()
            .WithMessageDetails()
            .Where(x => x.ChannelId == channelId && (x.Id == rootId || x.ReplyToMessageId == rootId))
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        if (messages.All(x => x.Id != rootId))
        {
            return Results.NotFound();
        }

        var viewerId = http.User.RequireUserId();
        return Results.Ok(new ThreadMessagesDto(messages.Select(x => x.ToDto(viewerId)).ToArray()));
    }
}
