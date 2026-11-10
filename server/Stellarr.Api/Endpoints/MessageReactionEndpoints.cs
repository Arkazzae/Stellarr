using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>Reacting to a message with an emoji, and taking the reaction back.</summary>
public static class MessageReactionEndpoints
{
    private const int MaxEmojiLength = 64;

    public static IEndpointRouteBuilder MapMessageReactionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapPut("/messages/{messageId:guid}/reactions/{emoji}", AddAsync);
        api.MapDelete("/messages/{messageId:guid}/reactions/{emoji}", RemoveAsync);
        return endpoints;
    }

    private static Task<IResult> AddAsync(
        Guid messageId,
        string emoji,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken) =>
        SetAsync(messageId, emoji, added: true, http, db, hub, cancellationToken);

    private static Task<IResult> RemoveAsync(
        Guid messageId,
        string emoji,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken) =>
        SetAsync(messageId, emoji, added: false, http, db, hub, cancellationToken);

    /// <summary>
    /// Makes the caller's reaction present or absent. Doing either twice is
    /// not an error, and the answer and the event say how things stand now,
    /// so a client that lost a response can simply ask again.
    /// </summary>
    private static async Task<IResult> SetAsync(
        Guid messageId,
        string emoji,
        bool added,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        emoji = emoji.Trim();
        if (emoji.Length is < 1 or > MaxEmojiLength || emoji.Any(char.IsWhiteSpace))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["emoji"] = [$"Reakcja musi mieć od 1 do {MaxEmojiLength} znaków i nie może zawierać spacji."],
            });
        }

        var serverId = http.RequireActiveServerId();
        var channelId = await db.Messages.AsNoTracking()
            .Where(x => x.Id == messageId &&
                db.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == serverId))
            .Select(x => (Guid?)x.ChannelId)
            .SingleOrDefaultAsync(cancellationToken);
        if (channelId is null)
        {
            return Results.NotFound();
        }

        var userId = http.User.RequireUserId();
        if (added)
        {
            // The key is the whole reaction, so asking twice, or twice at once,
            // leaves one row without either request failing.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "MessageReactions" ("MessageId", "UserId", "Emoji", "CreatedAt")
                VALUES ({messageId}, {userId}, {emoji}, {DateTime.UtcNow})
                ON CONFLICT DO NOTHING
                """,
                cancellationToken);
        }
        else
        {
            await db.MessageReactions
                .Where(x => x.MessageId == messageId && x.UserId == userId && x.Emoji == emoji)
                .ExecuteDeleteAsync(cancellationToken);
        }

        var count = await db.MessageReactions.CountAsync(
            x => x.MessageId == messageId && x.Emoji == emoji,
            cancellationToken);
        var changed = new MessageReactionChangedDto(
            messageId.ToString(),
            channelId.Value.ToString(),
            emoji,
            count,
            userId.ToString(),
            added);
        await hub.Clients.Group(AppHub.ServerGroup(serverId))
            .SendAsync("MessageReactionChanged", changed, CancellationToken.None);
        return Results.Ok(changed);
    }
}
