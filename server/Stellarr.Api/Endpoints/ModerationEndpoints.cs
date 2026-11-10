using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Removing people from a server: kicking, which they can undo by joining
/// again, and banning, which stays until a moderator lifts it.
/// </summary>
public static class ModerationEndpoints
{
    private const int MaximumReasonLength = 500;
    private const string DefaultReason = "Bez podanego powodu";

    public static IEndpointRouteBuilder MapModerationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var moderation = endpoints.MapGroup("/api/admin")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        moderation.MapGet("/bans", ListBansAsync);
        moderation.MapPost("/members/{userId:guid}/ban", BanAsync);
        moderation.MapDelete("/bans/{userId:guid}", UnbanAsync);
        moderation.MapDelete("/members/{userId:guid}", KickAsync);
        return endpoints;
    }

    /// <summary>
    /// Finds the member a moderator acts on, or says why the moderator may not.
    /// Nobody acts on themselves, on the owner, or on a member whose role does
    /// not rank below their own; the owner outranks everybody else.
    /// </summary>
    /// <param name="channelId">
    /// The channel the action is about. Its overrides then apply to the
    /// moderator's privileges; without it the role's privileges decide.
    /// </param>
    internal static async Task<ModerationLookup> FindTargetAsync(
        AppDbContext db,
        Guid serverId,
        Guid actorId,
        Guid targetId,
        ServerPrivileges required,
        CancellationToken cancellationToken,
        Guid? channelId = null)
    {
        if (actorId == targetId)
        {
            return ModerationLookup.Refused(Results.Forbid());
        }

        var actor = await db.ServerMembers
            .Include(x => x.Role)
            .Include(x => x.User)
            .FirstOrDefaultAsync(x => x.ServerId == serverId && x.UserId == actorId, cancellationToken);
        if (actor is null)
        {
            return ModerationLookup.Refused(Results.Forbid());
        }

        var allowed = channelId is { } channel
            ? await ServerAccess.HasAsync(db, actorId, serverId, channel, required, cancellationToken)
            : actor.Role.Permissions.HasFlag(required);
        if (!allowed)
        {
            return ModerationLookup.Refused(Results.Forbid());
        }

        var target = await db.ServerMembers
            .Include(x => x.Role)
            .Include(x => x.User)
            .FirstOrDefaultAsync(x => x.ServerId == serverId && x.UserId == targetId, cancellationToken);
        if (target is null)
        {
            return ModerationLookup.Refused(Results.NotFound());
        }

        var outranked = target.Role.IsOwner ||
            (!actor.Role.IsOwner && target.Role.Position <= actor.Role.Position);
        return outranked
            ? ModerationLookup.Refused(Results.Forbid())
            : new ModerationLookup(actor, target, Refusal: null);
    }

    private static async Task<IResult> ListBansAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        if (!await CanManageBansAsync(http, db, serverId, cancellationToken))
        {
            return Results.Forbid();
        }

        var bans = await db.ServerBans.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .Include(x => x.User)
            .Include(x => x.BannedBy)
            .OrderByDescending(x => x.BannedAt)
            .ToListAsync(cancellationToken);
        return Results.Ok(bans.Select(x => x.ToDto()));
    }

    private static async Task<IResult> BanAsync(
        Guid userId,
        BanMemberRequest request,
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length > MaximumReasonLength)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["reason"] = [$"Powód bana może mieć najwyżej {MaximumReasonLength} znaków."],
            });
        }

        var serverId = http.RequireActiveServerId();
        var lookup = await FindTargetAsync(
            db, serverId, http.User.RequireUserId(), userId, ServerPrivileges.ManageBans, cancellationToken);
        if (lookup.IsRefused)
        {
            return lookup.Refusal;
        }

        var ban = new ServerBan
        {
            ServerId = serverId,
            UserId = userId,
            BannedById = lookup.Actor.UserId,
            Reason = reason.Length == 0 ? DefaultReason : reason,
            BannedAt = DateTime.UtcNow,
            User = lookup.Target.User,
            BannedBy = lookup.Actor.User,
        };
        db.ServerBans.Add(ban);
        db.ServerMembers.Remove(lookup.Target);
        if (!await TrySaveRemovalAsync(db, cancellationToken))
        {
            return Results.Conflict();
        }

        await PublishRemovalAsync(serverId, userId, "banned", db, presence, hub);
        return Results.Created($"/api/admin/bans/{userId}", ban.ToDto());
    }

    private static async Task<IResult> UnbanAsync(
        Guid userId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        if (!await CanManageBansAsync(http, db, serverId, cancellationToken))
        {
            return Results.Forbid();
        }

        // Lifting a ban lets the person join again; it does not make them a member.
        var ban = await db.ServerBans.FirstOrDefaultAsync(
            x => x.ServerId == serverId && x.UserId == userId, cancellationToken);
        if (ban is null)
        {
            return Results.NotFound();
        }

        db.ServerBans.Remove(ban);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> KickAsync(
        Guid userId,
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var lookup = await FindTargetAsync(
            db, serverId, http.User.RequireUserId(), userId, ServerPrivileges.ModerateMembers, cancellationToken);
        if (lookup.IsRefused)
        {
            return lookup.Refusal;
        }

        db.ServerMembers.Remove(lookup.Target);
        if (!await TrySaveRemovalAsync(db, cancellationToken))
        {
            return Results.Conflict();
        }

        await PublishRemovalAsync(serverId, userId, "kicked", db, presence, hub);
        return Results.NoContent();
    }

    private static async Task<bool> CanManageBansAsync(
        HttpContext http,
        AppDbContext db,
        Guid serverId,
        CancellationToken cancellationToken) =>
        await ServerAccess.HasAsync(
            db, http.User.RequireUserId(), serverId, ServerPrivileges.ManageBans, cancellationToken);

    /// <summary>
    /// Saves the removal of a membership. False means somebody else got there
    /// first, whether by banning the same person or by removing them.
    /// </summary>
    private static async Task<bool> TrySaveRemovalAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            return await db.TrySaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }

    /// <summary>
    /// Cuts a removed member off from everything live: their voice seats, the
    /// server's and its text channels' groups. They hear about it through
    /// their own user group, which outlives the membership.
    /// </summary>
    private static async Task PublishRemovalAsync(
        Guid serverId,
        Guid userId,
        string kind,
        AppDbContext db,
        PresenceTracker presence,
        IHubContext<AppHub> hub)
    {
        var channels = await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .Select(x => new { x.Id, x.Kind })
            .ToListAsync();
        var voiceRoomIds = channels.Where(x => x.Kind == ChannelKind.Voice).Select(x => x.Id).ToHashSet();
        var departures = presence.RemoveUserFromVoiceChannels(userId, voiceRoomIds);

        await hub.Clients.Group(AppHub.ServerGroup(serverId)).SendAsync(
            "ServerMemberRemoved", new { serverId = serverId.ToString(), userId = userId.ToString() });
        await hub.Clients.Group(AppHub.UserGroup(userId)).SendAsync(
            "ServerAccessRevoked", new { serverId = serverId.ToString(), kind });

        // Only text channels have groups of their own; voice rooms are addressed by connection.
        var groups = channels.Where(x => x.Kind == ChannelKind.Text)
            .Select(x => AppHub.ChannelGroup(x.Id))
            .Prepend(AppHub.ServerGroup(serverId))
            .ToList();
        foreach (var connectionId in presence.ConnectionIds(userId))
        {
            foreach (var group in groups)
            {
                await hub.Groups.RemoveFromGroupAsync(connectionId, group);
            }
        }

        foreach (var roomId in departures.Select(x => x.ChannelId).Distinct())
        {
            await AppHub.BroadcastVoiceSnapshotAsync(hub.Clients, db, presence, roomId);
        }
    }

    /// <summary>The outcome of <see cref="FindTargetAsync"/>: the two members, or the answer to give instead.</summary>
    internal sealed record ModerationLookup(ServerMember? Actor, ServerMember? Target, IResult? Refusal)
    {
        [MemberNotNullWhen(true, nameof(Refusal))]
        [MemberNotNullWhen(false, nameof(Actor), nameof(Target))]
        public bool IsRefused => Refusal is not null;

        internal static ModerationLookup Refused(IResult refusal) => new(Actor: null, Target: null, refusal);
    }
}
