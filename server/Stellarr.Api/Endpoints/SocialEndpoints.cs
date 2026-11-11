using System.Security.Claims;
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

/// <summary>
/// Friend requests, friendships and blocks. They belong to the instance, not
/// to a server, so none of these routes has a server filter. Direct messages,
/// which hang off the same relationships, are in <see cref="DirectMessageEndpoints"/>.
/// </summary>
public static class SocialEndpoints
{
    public static IEndpointRouteBuilder MapSocialEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var social = endpoints.MapGroup("/api/social").RequireAuthorization();
        social.MapGet("", GetStateAsync);
        social.MapPost("/requests", CreateRequestAsync);
        social.MapPost("/requests/{requestId:guid}/accept", AcceptRequestAsync);
        social.MapDelete("/requests/{requestId:guid}", DeleteRequestAsync);
        social.MapDelete("/friends/{userId:guid}", RemoveFriendAsync);
        social.MapPost("/blocks/{userId:guid}", BlockAsync);
        social.MapDelete("/blocks/{userId:guid}", UnblockAsync);
        return endpoints;
    }

    /// <summary>
    /// Everything the friends screen shows. A conversation with somebody the
    /// viewer blocked, or who blocked the viewer, is left out.
    /// </summary>
    private static async Task<IResult> GetStateAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        var friendships = await db.Friendships.AsNoTracking()
            .Where(x => x.UserAId == userId || x.UserBId == userId)
            .ToListAsync(cancellationToken);
        var requests = await db.FriendRequests.AsNoTracking()
            .Where(x => x.SenderId == userId || x.ReceiverId == userId)
            .ToListAsync(cancellationToken);
        var blocks = await db.UserBlocks.AsNoTracking()
            .Where(x => x.BlockerId == userId || x.BlockedId == userId)
            .ToListAsync(cancellationToken);
        var blockedByViewer = blocks.Where(x => x.BlockerId == userId).Select(x => x.BlockedId).ToArray();
        var peersInBlock = blocks.Select(x => Other(x.BlockerId, x.BlockedId, userId)).ToHashSet();
        var conversations = (await db.DirectConversations.AsNoTracking()
                .Where(x => x.UserAId == userId || x.UserBId == userId)
                .ToListAsync(cancellationToken))
            .Where(x => !peersInBlock.Contains(PeerId(x, userId)))
            .ToArray();

        var personIds = friendships.Select(x => Other(x.UserAId, x.UserBId, userId))
            .Concat(requests.Select(x => Other(x.SenderId, x.ReceiverId, userId)))
            .Concat(blockedByViewer)
            .Concat(conversations.Select(x => PeerId(x, userId)))
            .Distinct()
            .ToArray();
        var people = await db.Users.AsNoTracking()
            .Where(x => personIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, cancellationToken);
        UserDto Person(Guid id) => people[id].ToDto(presence.PublicPresenceOf(id, userId));

        var conversationIds = conversations.Select(x => x.Id).ToArray();
        var lastMessages = await LastMessagesAsync(db, conversationIds, cancellationToken);
        var unreadCounts = await UnreadCountsAsync(db, userId, conversationIds, cancellationToken);

        return Results.Ok(new SocialStateDto(
            friendships
                .Where(x => people.ContainsKey(Other(x.UserAId, x.UserBId, userId)))
                .Select(x => new FriendDto(Person(Other(x.UserAId, x.UserBId, userId)), x.CreatedAt))
                .ToArray(),
            requests
                .Where(x => people.ContainsKey(Other(x.SenderId, x.ReceiverId, userId)))
                .Select(x => new FriendRequestDto(
                    x.Id.ToString(),
                    Person(Other(x.SenderId, x.ReceiverId, userId)),
                    x.ReceiverId == userId ? "incoming" : "outgoing",
                    x.CreatedAt))
                .ToArray(),
            blockedByViewer.Where(people.ContainsKey).Select(Person).ToArray(),
            conversations
                .Where(x => people.ContainsKey(PeerId(x, userId)))
                .Select(x =>
                {
                    var last = lastMessages.GetValueOrDefault(x.Id);
                    return new DirectConversationDto(
                        x.Id.ToString(),
                        Person(PeerId(x, userId)),
                        last?.ToDto(),
                        unreadCounts.GetValueOrDefault(x.Id),
                        last?.CreatedAt ?? x.CreatedAt);
                })
                .OrderByDescending(x => x.UpdatedAt)
                .ToArray()));
    }

    private static async Task<Dictionary<Guid, DirectMessage>> LastMessagesAsync(
        AppDbContext db,
        Guid[] conversationIds,
        CancellationToken cancellationToken) =>
        await db.DirectMessages.AsNoTracking()
            .Where(message =>
                conversationIds.Contains(message.ConversationId) &&
                message.Id == db.DirectMessages
                    .Where(candidate => candidate.ConversationId == message.ConversationId)
                    .OrderByDescending(candidate => candidate.CreatedAt)
                    .ThenByDescending(candidate => candidate.Id)
                    .Select(candidate => candidate.Id)
                    .First())
            .WithMessageDetails()
            .ToDictionaryAsync(x => x.ConversationId, cancellationToken);

    /// <summary>
    /// What the viewer has not read: the other person's messages after the
    /// read marker, or after the conversation began while there is no marker.
    /// </summary>
    private static async Task<Dictionary<Guid, int>> UnreadCountsAsync(
        AppDbContext db,
        Guid userId,
        Guid[] conversationIds,
        CancellationToken cancellationToken) =>
        await (
            from message in db.DirectMessages.AsNoTracking()
            join conversation in db.DirectConversations.AsNoTracking()
                on message.ConversationId equals conversation.Id
            join read in db.DirectConversationReads.AsNoTracking().Where(x => x.UserId == userId)
                on message.ConversationId equals read.ConversationId into readRows
            from read in readRows.DefaultIfEmpty()
            where conversationIds.Contains(message.ConversationId) &&
                message.AuthorId != userId &&
                message.CreatedAt > (read == null ? conversation.CreatedAt : read.LastReadAt)
            group message by message.ConversationId into unread
            select new { ConversationId = unread.Key, Count = unread.Count() })
            .ToDictionaryAsync(x => x.ConversationId, x => x.Count, cancellationToken);

    /// <summary>
    /// Always answers 200 with a result code, so that the form can say what
    /// happened without telling a stranger which usernames exist: an account
    /// that takes no requests reads exactly like one that is not there.
    /// </summary>
    private static async Task<IResult> CreateRequestAsync(
        CreateFriendRequestRequest request,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        var username = request.Username?.Trim().TrimStart('@') ?? "";
        if (username.Length == 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["username"] = [messages.Get(MessageKey.FriendUsernameRequired)],
            });
        }

        var normalizedUsername = username.ToUpperInvariant();
        var target = await db.Users.AsNoTracking()
            .Include(x => x.Preferences)
            .SingleOrDefaultAsync(x => x.NormalizedUsername == normalizedUsername, cancellationToken);
        if (target is null || target.Preferences?.AllowFriendRequests == false)
        {
            return Answer("unknown-user");
        }

        if (target.Id == userId)
        {
            return Answer("self");
        }

        if (await IsBlockedAsync(db, userId, target.Id, cancellationToken))
        {
            return Answer("blocked");
        }

        var (a, b) = Pair(userId, target.Id);
        if (await db.Friendships.AnyAsync(x => x.UserAId == a && x.UserBId == b, cancellationToken))
        {
            return Answer("already-friends");
        }

        if (await db.FriendRequests.AnyAsync(x =>
                (x.SenderId == userId && x.ReceiverId == target.Id) ||
                (x.SenderId == target.Id && x.ReceiverId == userId), cancellationToken))
        {
            return Answer("already-sent");
        }

        db.FriendRequests.Add(new FriendRequest
        {
            Id = Guid.NewGuid(),
            SenderId = userId,
            ReceiverId = target.Id,
            PairKey = PairKey(userId, target.Id),
            CreatedAt = DateTime.UtcNow,
        });

        // Two people asking each other at the same moment both pass the checks
        // above; the unique pair key lets exactly one of them in.
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Answer("already-sent");
        }

        await NotifyAsync(hub, userId, target.Id);
        return Answer("sent");
    }

    private static async Task<IResult> AcceptRequestAsync(
        Guid requestId,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        var request = await db.FriendRequests.SingleOrDefaultAsync(
            x => x.Id == requestId && x.ReceiverId == userId, cancellationToken);
        if (request is null)
        {
            return Results.NotFound();
        }

        var (a, b) = Pair(request.SenderId, request.ReceiverId);
        if (!await db.Friendships.AnyAsync(x => x.UserAId == a && x.UserBId == b, cancellationToken))
        {
            db.Friendships.Add(new Friendship
            {
                Id = Guid.NewGuid(),
                UserAId = a,
                UserBId = b,
                CreatedAt = DateTime.UtcNow,
            });
        }

        db.FriendRequests.Remove(request);
        await SaveSettledAsync(db, cancellationToken);
        await NotifyAsync(hub, request.SenderId, request.ReceiverId);
        return Results.NoContent();
    }

    /// <summary>Declines a request the viewer received, or withdraws one they sent.</summary>
    private static async Task<IResult> DeleteRequestAsync(
        Guid requestId,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        var request = await db.FriendRequests.SingleOrDefaultAsync(
            x => x.Id == requestId && (x.SenderId == userId || x.ReceiverId == userId), cancellationToken);
        if (request is null)
        {
            return Results.NotFound();
        }

        db.FriendRequests.Remove(request);
        await SaveSettledAsync(db, cancellationToken);
        await NotifyAsync(hub, request.SenderId, request.ReceiverId);
        return Results.NoContent();
    }

    private static async Task<IResult> RemoveFriendAsync(
        Guid userId,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var selfId = principal.RequireUserId();
        var (a, b) = Pair(selfId, userId);
        var friendship = await db.Friendships.SingleOrDefaultAsync(
            x => x.UserAId == a && x.UserBId == b, cancellationToken);
        if (friendship is null)
        {
            return Results.NotFound();
        }

        db.Friendships.Remove(friendship);
        await SaveSettledAsync(db, cancellationToken);
        await NotifyAsync(hub, selfId, userId);
        return Results.NoContent();
    }

    /// <summary>
    /// Blocks somebody: the friendship and any pending request between the two
    /// go, in both directions, and a call between them ends. Blocking again is
    /// a no-op.
    /// </summary>
    private static async Task<IResult> BlockAsync(
        Guid userId,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        var selfId = principal.RequireUserId();
        if (selfId == userId || !await db.Users.AnyAsync(x => x.Id == userId, cancellationToken))
        {
            return Results.NotFound();
        }

        var (a, b) = Pair(selfId, userId);
        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            // Deleting by predicate cannot fail because somebody else got there
            // first, so a request answered at the same moment never loses the block.
            await db.Friendships.Where(x => x.UserAId == a && x.UserBId == b)
                .ExecuteDeleteAsync(cancellationToken);
            await db.FriendRequests.Where(x =>
                    (x.SenderId == selfId && x.ReceiverId == userId) ||
                    (x.SenderId == userId && x.ReceiverId == selfId))
                .ExecuteDeleteAsync(cancellationToken);
            if (!await db.UserBlocks.AnyAsync(x => x.BlockerId == selfId && x.BlockedId == userId, cancellationToken))
            {
                db.UserBlocks.Add(new UserBlock { BlockerId = selfId, BlockedId = userId, CreatedAt = DateTime.UtcNow });
                // Losing to an identical block leaves the state that was asked for.
                await db.TrySaveChangesAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        }

        await EndDirectCallAsync(hub, db, presence, a, b, selfId);
        await NotifyAsync(hub, selfId, userId);
        return Results.NoContent();
    }

    private static async Task<IResult> UnblockAsync(
        Guid userId,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var selfId = principal.RequireUserId();
        var block = await db.UserBlocks.SingleOrDefaultAsync(
            x => x.BlockerId == selfId && x.BlockedId == userId, cancellationToken);
        if (block is null)
        {
            return Results.NotFound();
        }

        db.UserBlocks.Remove(block);
        await SaveSettledAsync(db, cancellationToken);
        await NotifyAsync(hub, selfId, userId);
        return Results.NoContent();
    }

    /// <summary>
    /// A call's media keeps flowing through the media server until its seats
    /// end, so it would outlive the block in the database. The private room is
    /// therefore emptied, which closes both media sessions, and both clients
    /// are told, so that they let go of microphones and remote media.
    /// The block is stored by now, so a client that hangs up must not keep
    /// the call alive.
    /// </summary>
    private static async Task EndDirectCallAsync(
        IHubContext<AppHub> hub,
        AppDbContext db,
        PresenceTracker presence,
        Guid firstId,
        Guid secondId,
        Guid blockerId)
    {
        var roomId = await db.DirectConversations.AsNoTracking()
            .Where(x => x.UserAId == firstId && x.UserBId == secondId)
            .Select(x => (Guid?)x.Id)
            .SingleOrDefaultAsync(CancellationToken.None);
        if (roomId is not { } room)
        {
            return;
        }

        var seated = presence.EndVoiceRoom(room);
        if (seated.Count > 0)
        {
            await hub.Clients.Clients(seated).SendAsync(
                "DirectCallDeclined",
                new { channelId = room.ToString(), byUserId = blockerId.ToString() },
                CancellationToken.None);
        }

        await AppHub.BroadcastVoiceSnapshotAsync(hub.Clients, db, presence, room, CancellationToken.None);
    }

    /// <summary>
    /// Saves a change whose wanted end state may already have been reached by
    /// a request that ran at the same time: the row to remove is gone, or the
    /// row to add exists. Either way there is nothing left to do.
    /// </summary>
    private static async Task SaveSettledAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            exception is DbUpdateConcurrencyException || DatabaseErrors.IsUniqueConstraint(exception))
        {
            db.ChangeTracker.Clear();
        }
    }

    private static IResult Answer(string result) => Results.Ok(new FriendRequestResultDto(result));

    internal static Task<bool> IsBlockedAsync(
        AppDbContext db, Guid first, Guid second, CancellationToken cancellationToken) =>
        db.UserBlocks.AnyAsync(x =>
            (x.BlockerId == first && x.BlockedId == second) ||
            (x.BlockerId == second && x.BlockedId == first), cancellationToken);

    /// <summary>Tells both people's clients to reload the friends screen.</summary>
    internal static Task NotifyAsync(IHubContext<AppHub> hub, params Guid[] userIds) =>
        hub.Clients.Groups(userIds.Distinct().Select(AppHub.UserGroup))
            .SendAsync("SocialChanged", new { }, CancellationToken.None);

    /// <summary>The two ids in the canonical order that friendships and conversations are stored in.</summary>
    internal static (Guid A, Guid B) Pair(Guid first, Guid second) =>
        first.CompareTo(second) < 0 ? (first, second) : (second, first);

    /// <summary>One value for a pair of people whichever of them sent the request.</summary>
    internal static string PairKey(Guid first, Guid second)
    {
        var (a, b) = Pair(first, second);
        return $"{a:N}:{b:N}";
    }

    internal static Guid Other(Guid first, Guid second, Guid self) => first == self ? second : first;

    internal static Guid PeerId(DirectConversation conversation, Guid self) =>
        Other(conversation.UserAId, conversation.UserBId, self);
}
