using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Realtime;

/// <summary>
/// Voice rooms. A room id is either a voice channel of a server the caller
/// belongs to or a direct conversation between two people; both use the same
/// signalling envelope, so the media client only relays and this hub decides
/// who may take part.
/// </summary>
public sealed partial class AppHub
{
    private static readonly VoiceRoomAccess NoVoiceAccess = new(Allowed: false, UserLimit: 0);

    public async Task JoinVoice(string channelId)
    {
        var roomId = ParseGuid(channelId, nameof(channelId));
        var userId = Context.User!.RequireUserId();
        var access = await VoiceRoomAccessAsync(roomId, userId);
        if (!access.Allowed)
        {
            throw new HubException("Unknown voice room.");
        }

        var join = presence.JoinVoice(Context.ConnectionId, userId, roomId, access.UserLimit);
        if (!join.Accepted)
        {
            throw new HubException("Voice room is full.");
        }

        foreach (var displaced in join.Displaced)
        {
            await Clients.Client(displaced.ConnectionId)
                .SendAsync("VoiceSessionReplaced", new { channelId = displaced.ChannelId.ToString() });
        }

        var vacatedRooms = join.Displaced
            .Select(x => x.ChannelId)
            .Concat(join.PreviousChannelId is { } previous ? [previous] : [])
            .Where(x => x != roomId)
            .Distinct();
        foreach (var vacated in vacatedRooms)
        {
            await BroadcastVoiceSnapshotAsync(vacated);
        }

        await BroadcastVoiceSnapshotAsync(roomId);
        await AnnounceJoinSoundAsync(roomId, userId);
    }

    public async Task LeaveVoice()
    {
        if (presence.LeaveVoice(Context.ConnectionId) is { } departure)
        {
            await BroadcastVoiceSnapshotAsync(departure.ChannelId);
        }
    }

    /// <summary>Ends a direct call for both people, whether or not it was ever answered.</summary>
    public async Task DeclineDirectCall(string conversationId)
    {
        var id = ParseGuid(conversationId, nameof(conversationId));
        var userId = Context.User!.RequireUserId();

        // Either person may always decline, even after a block or a change of
        // preferences that would now refuse a new call: a call that is still
        // ringing has to stay dismissable.
        if (!await db.DirectConversations.AsNoTracking()
                .AnyAsync(x => x.Id == id && (x.UserAId == userId || x.UserBId == userId)))
        {
            throw new HubException("Unknown direct call.");
        }

        var seated = presence.EndVoiceRoom(id);
        if (seated.Count > 0)
        {
            await Clients.Clients(seated).SendAsync(
                "DirectCallDeclined",
                new { channelId = id.ToString(), byUserId = userId.ToString() });
        }

        await BroadcastVoiceSnapshotAsync(id);
    }

    public async Task SendVoiceSignal(VoiceSignalDto signal)
    {
        if (signal is null)
        {
            throw new HubException("Invalid voice signal.");
        }

        var roomId = ParseGuid(signal.ChannelId, nameof(signal.ChannelId));
        var senderId = Context.User!.RequireUserId();
        // Behind the media server only the state travels from browser to
        // browser; a direct connection would bypass it and give away addresses.
        if (!IsRelayable(signal) ||
            (mediaTopology.IsSfu && RtcProtocol.PeerConnectionKinds.Contains(signal.Kind)) ||
            !presence.IsConnectionInVoice(Context.ConnectionId, roomId) ||
            !(await VoiceRoomAccessAsync(roomId, senderId)).Allowed)
        {
            throw new HubException("Invalid voice signal.");
        }

        // The room's occupancy follows the sender's own state whether or not
        // anybody is left to receive the signal.
        if (signal.Kind == "state" && ReadMuted(signal.Payload) is { } muted)
        {
            presence.SetVoiceMuted(Context.ConnectionId, muted);
            await BroadcastVoiceSnapshotAsync(roomId);
        }

        var recipients = VoiceSignalRecipients(signal, roomId);
        if (recipients.Count > 0)
        {
            await Clients.Clients(recipients).SendAsync("VoiceSignal", new
            {
                protocolVersion = RtcProtocol.Version,
                channelId = roomId.ToString(),
                fromUserId = senderId.ToString(),
                toUserId = signal.ToUserId,
                kind = signal.Kind,
                payload = signal.Payload,
            });
        }
    }

    /// <summary>
    /// Sends everybody who should see a room its current occupants. The hub
    /// and the moderation endpoints, which also change who sits where, share it.
    /// </summary>
    /// <remarks>
    /// A server's voice channel is public to the whole server, which is how
    /// people see who is talking before they join. A direct call is as private
    /// as its transcript and only reaches its two owners.
    /// </remarks>
    internal static async Task BroadcastVoiceSnapshotAsync(
        IHubClients<IClientProxy> clients,
        AppDbContext db,
        PresenceTracker presence,
        Guid roomId,
        CancellationToken cancellationToken = default)
    {
        // Taken before the lookups below, which finish in no fixed order: the
        // sequence has to follow the order in which seats changed.
        var snapshot = presence.VoiceSnapshot(roomId);
        var userIds = snapshot.Participants.Select(x => x.UserId).ToArray();
        var names = new Dictionary<Guid, string>();
        if (userIds.Length > 0)
        {
            names = await db.Users.AsNoTracking()
                .Where(x => userIds.Contains(x.Id))
                .ToDictionaryAsync(x => x.Id, x => x.DisplayName, cancellationToken);
        }

        var occupancy = new
        {
            channelId = roomId.ToString(),
            sequence = snapshot.Sequence,
            participants = snapshot.Participants
                .Where(x => names.ContainsKey(x.UserId))
                .Select(x => new VoiceOccupantDto(x.UserId.ToString(), names[x.UserId], x.Muted))
                .ToArray(),
        };

        var conversation = await db.DirectConversations.AsNoTracking()
            .Where(x => x.Id == roomId)
            .Select(x => new { x.UserAId, x.UserBId })
            .SingleOrDefaultAsync(cancellationToken);
        if (conversation is not null)
        {
            await clients.Groups(UserGroup(conversation.UserAId), UserGroup(conversation.UserBId))
                .SendAsync("VoiceParticipantChanged", occupancy, cancellationToken);
            return;
        }

        var serverId = await db.Channels.AsNoTracking()
            .Where(x => x.Id == roomId)
            .Select(x => (Guid?)x.ServerId)
            .SingleOrDefaultAsync(cancellationToken);
        if (serverId is { } server)
        {
            await clients.Group(ServerGroup(server)).SendAsync("VoiceParticipantChanged", occupancy, cancellationToken);
        }
    }

    /// <summary>
    /// A caller that was offline, or reconnecting, while a call was started
    /// needs to hear about it. Only direct rooms are restored: the bootstrap
    /// already carries the occupancy of voice channels.
    /// </summary>
    private async Task RestoreDirectCallSnapshotsAsync(Guid userId)
    {
        var activeRooms = presence.ActiveVoiceRoomIds();
        if (activeRooms.Count == 0)
        {
            return;
        }

        var ownRooms = await db.DirectConversations.AsNoTracking()
            .Where(x => activeRooms.Contains(x.Id) && (x.UserAId == userId || x.UserBId == userId))
            .Select(x => x.Id)
            .ToArrayAsync();
        foreach (var roomId in ownRooms)
        {
            await BroadcastVoiceSnapshotAsync(roomId);
        }
    }

    private Task BroadcastVoiceSnapshotAsync(Guid roomId) =>
        BroadcastVoiceSnapshotAsync(Clients, db, presence, roomId);

    /// <summary>
    /// Who gets a signal: the one peer it names, which must sit in the room, or
    /// else every other connection there.
    /// </summary>
    private IReadOnlyList<string> VoiceSignalRecipients(VoiceSignalDto signal, Guid roomId)
    {
        if (signal.ToUserId is null)
        {
            return [.. presence.VoiceConnectionIds(roomId).Where(x => x != Context.ConnectionId)];
        }

        var peerConnections = Guid.TryParse(signal.ToUserId, out var peerId)
            ? presence.VoiceConnectionIds(peerId, roomId)
            : [];
        return peerConnections.Count > 0
            ? peerConnections
            : throw new HubException("Voice signal target is not in this channel.");
    }

    private static bool IsRelayable(VoiceSignalDto signal) =>
        signal.ProtocolVersion == RtcProtocol.Version &&
        RtcProtocol.SignalKinds.Contains(signal.Kind) &&
        signal.Payload is not null &&
        Encoding.UTF8.GetByteCount(signal.Payload) <= RtcProtocol.MaxSignalBytes;

    /// <summary>The mute flag of a "state" payload; null when it does not say.</summary>
    private static bool? ReadMuted(string payload)
    {
        try
        {
            using var state = JsonDocument.Parse(payload);
            if (state.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new HubException("Invalid voice state.");
            }

            return state.RootElement.TryGetProperty("muted", out var muted) &&
                muted.ValueKind is JsonValueKind.True or JsonValueKind.False
                    ? muted.GetBoolean()
                    : null;
        }
        catch (JsonException)
        {
            throw new HubException("Invalid voice state.");
        }
    }

    private async Task<VoiceRoomAccess> VoiceRoomAccessAsync(Guid roomId, Guid userId)
    {
        var channel = await db.Channels.AsNoTracking()
            .Where(x => x.Id == roomId &&
                x.Kind == ChannelKind.Voice &&
                db.ServerMembers.Any(member => member.ServerId == x.ServerId && member.UserId == userId))
            .Select(x => new { x.UserLimit })
            .SingleOrDefaultAsync();
        if (channel is not null)
        {
            return new VoiceRoomAccess(Allowed: true, channel.UserLimit);
        }

        var conversation = await db.DirectConversations.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == roomId && (x.UserAId == userId || x.UserBId == userId));
        return conversation is not null && await DirectCallAllowedAsync(conversation, userId)
            ? new VoiceRoomAccess(Allowed: true, UserLimit: 0)
            : NoVoiceAccess;
    }

    /// <summary>
    /// A direct call is refused when either person blocked the other. Otherwise
    /// it is open to a caller whose peer is already seated, to one whose peer
    /// takes direct messages from anybody, and to friends.
    /// </summary>
    private async Task<bool> DirectCallAllowedAsync(DirectConversation conversation, Guid userId)
    {
        var peerId = conversation.UserAId == userId ? conversation.UserBId : conversation.UserAId;
        if (await db.UserBlocks.AsNoTracking().AnyAsync(x =>
                (x.BlockerId == userId && x.BlockedId == peerId) ||
                (x.BlockerId == peerId && x.BlockedId == userId)))
        {
            return false;
        }

        // Answering a call that is already ringing must not depend on the
        // answerer's own direct-message preference.
        if (presence.VoiceUsers(conversation.Id).Any(x => x.UserId == peerId))
        {
            return true;
        }

        var peerTakesDirectMessages = await db.UserPreferences.AsNoTracking()
            .Where(x => x.UserId == peerId)
            .Select(x => (bool?)x.AllowDirectMessages)
            .SingleOrDefaultAsync() ?? true;
        if (peerTakesDirectMessages)
        {
            return true;
        }

        var (first, second) = userId.CompareTo(peerId) < 0 ? (userId, peerId) : (peerId, userId);
        return await db.Friendships.AsNoTracking().AnyAsync(x => x.UserAId == first && x.UserBId == second);
    }

    private readonly record struct VoiceRoomAccess(bool Allowed, int UserLimit);
}
