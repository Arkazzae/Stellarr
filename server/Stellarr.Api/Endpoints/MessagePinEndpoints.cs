using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Messaging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>Keeping a few messages above a channel's conversation.</summary>
public static class MessagePinEndpoints
{
    /// <summary>
    /// A ceiling on pins, so the pinned list stays a short list of things worth
    /// keeping rather than a second transcript nobody reads.
    /// </summary>
    private const int MaxPinsPerChannel = 50;

    public static IEndpointRouteBuilder MapMessagePinEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapGet("/channels/{channelId:guid}/pins", ListAsync);
        api.MapPut("/messages/{messageId:guid}/pin", PinAsync);
        api.MapDelete("/messages/{messageId:guid}/pin", UnpinAsync);
        return endpoints;
    }

    /// <summary>
    /// The channel's pinned messages, newest pin first. A read of its own
    /// rather than a flag the transcript carries: a pin is usually on a
    /// message far above the last page, and a list derived from whatever the
    /// client has loaded would grow as the reader scrolls.
    /// </summary>
    private static async Task<IResult> ListAsync(
        Guid channelId,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (!await db.Channels.TextChannelOnServer(channelId, http.RequireActiveServerId())
                .AnyAsync(cancellationToken))
        {
            return Results.NotFound();
        }

        var pinned = await db.Messages.AsNoTracking()
            .WithMessageDetails()
            .Where(x => x.ChannelId == channelId && x.PinnedAt != null)
            .OrderByDescending(x => x.PinnedAt)
            .Take(MaxPinsPerChannel)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        var viewerId = http.User.RequireUserId();
        return Results.Ok(new PinnedMessagesDto(pinned.Select(x => x.ToDto(messages, viewerId)).ToArray()));
    }

    private static Task<IResult> PinAsync(
        Guid messageId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken) =>
        SetAsync(messageId, pinned: true, http, db, hub, messages, cancellationToken);

    private static Task<IResult> UnpinAsync(
        Guid messageId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken) =>
        SetAsync(messageId, pinned: false, http, db, hub, messages, cancellationToken);

    /// <summary>
    /// Pins or unpins a message, for whoever can manage messages in its
    /// channel. A pin puts one message above the conversation for everybody
    /// who opens the channel, so it is moderation and not the author's right,
    /// as editing is. Doing either twice is not an error, and pinning a
    /// pinned message leaves its pin where it is instead of moving it to the
    /// top of the list.
    /// </summary>
    private static async Task<IResult> SetAsync(
        Guid messageId,
        bool pinned,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var message = await db.Messages
            .WithMessageDetails()
            .Where(x => x.Id == messageId &&
                db.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == serverId))
            .AsSplitQuery()
            .FirstOrDefaultAsync(cancellationToken);
        if (message is null)
        {
            return Results.NotFound();
        }

        // 403 rather than the 404 that deleting uses: everybody who can read
        // the channel already sees this message, so there is nothing to
        // conceal, only a reason to give, and it is the true one.
        var userId = http.User.RequireUserId();
        if (!await ServerAccess.HasAsync(
                db, userId, serverId, message.ChannelId, ServerPrivileges.ManageMessages, cancellationToken))
        {
            return Results.Forbid();
        }

        if (pinned != (message.PinnedAt is not null))
        {
            if (pinned && await db.Messages.CountAsync(
                    x => x.ChannelId == message.ChannelId && x.PinnedAt != null, cancellationToken) >= MaxPinsPerChannel)
            {
                // Name the rule: the way out is to unpin something, and that
                // is only obvious if the answer says so.
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["pins"] =
                    [messages.Get(MessageKey.PinLimitReached, ("max", MaxPinsPerChannel))],
                });
            }

            message.PinnedAt = pinned ? DateTime.UtcNow : null;
            await db.SaveChangesAsync(cancellationToken);
        }

        // The event is shared by everyone, so it cannot say which reactions
        // are the viewer's own.
        await hub.Clients.Group(AppHub.ServerGroup(serverId))
            .SendAsync("MessageUpdated", message.ToDto(messages), CancellationToken.None);
        return Results.Ok(message.ToDto(messages, userId));
    }
}
