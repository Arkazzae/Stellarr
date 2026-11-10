using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Moderating a live voice session without touching the membership: sending a
/// member out of a voice channel, or from one voice channel to another.
/// </summary>
public static class VoiceModerationEndpoints
{
    public static IEndpointRouteBuilder MapVoiceModerationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var moderation = endpoints.MapGroup("/api/admin")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        moderation.MapDelete("/channels/{channelId:guid}/members/{userId:guid}", KickFromVoiceAsync);
        moderation.MapPatch("/channels/{channelId:guid}/members/{userId:guid}", MoveAsync);
        return endpoints;
    }

    private static async Task<IResult> KickFromVoiceAsync(
        Guid channelId,
        Guid userId,
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        if (await CountVoiceChannelsAsync(db, serverId, [channelId], cancellationToken) != 1)
        {
            return Results.NotFound();
        }

        // The channel's own overrides decide here, since the action is about this channel.
        var lookup = await ModerationEndpoints.FindTargetAsync(
            db,
            serverId,
            http.User.RequireUserId(),
            userId,
            ServerPrivileges.ModerateMembers,
            cancellationToken,
            channelId);
        if (lookup.IsRefused)
        {
            return lookup.Refusal;
        }

        var seated = presence.VoiceConnectionIds(userId, channelId);
        presence.RemoveUserFromVoiceChannels(userId, new HashSet<Guid> { channelId });
        if (seated.Count > 0)
        {
            await hub.Clients.Clients(seated).SendAsync(
                "VoiceChannelKicked", new { channelId = channelId.ToString() }, CancellationToken.None);
            await AppHub.BroadcastVoiceSnapshotAsync(hub.Clients, db, presence, channelId, CancellationToken.None);
        }

        // Kicking somebody who has already gone is the end state that was asked for.
        return Results.NoContent();
    }

    private static async Task<IResult> MoveAsync(
        Guid channelId,
        Guid userId,
        MoveVoiceMemberRequest request,
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var lookup = await ModerationEndpoints.FindTargetAsync(
            db, serverId, http.User.RequireUserId(), userId, ServerPrivileges.ModerateMembers, cancellationToken);
        if (lookup.IsRefused)
        {
            return lookup.Refusal;
        }

        var targetChannelId = request.TargetChannelId;
        Guid[] rooms = [.. new[] { channelId, targetChannelId }.Distinct()];
        if (await CountVoiceChannelsAsync(db, serverId, rooms, cancellationToken) != rooms.Length)
        {
            return Results.NotFound();
        }

        if (channelId == targetChannelId)
        {
            return Results.NoContent();
        }

        // The connections keep their seats and their mute state; the client is
        // told to rebuild its peers for the new room.
        var move = presence.MoveUserBetweenVoiceChannels(userId, channelId, targetChannelId);
        if (!move.Moved)
        {
            return Results.Conflict();
        }

        await hub.Clients.Clients(move.ConnectionIds).SendAsync(
            "VoiceChannelMoved",
            new { fromChannelId = channelId.ToString(), toChannelId = targetChannelId.ToString() },
            CancellationToken.None);
        foreach (var room in rooms)
        {
            await AppHub.BroadcastVoiceSnapshotAsync(hub.Clients, db, presence, room, CancellationToken.None);
        }

        return Results.NoContent();
    }

    private static async Task<int> CountVoiceChannelsAsync(
        AppDbContext db,
        Guid serverId,
        Guid[] channelIds,
        CancellationToken cancellationToken) =>
        await db.Channels.AsNoTracking().CountAsync(
            x => channelIds.Contains(x.Id) && x.ServerId == serverId && x.Kind == ChannelKind.Voice,
            cancellationToken);
}
