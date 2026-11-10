using System.Collections.Frozen;

namespace Stellarr.Api.Realtime;

public sealed record VoiceDeparture(Guid UserId, Guid ChannelId);

public sealed record VoiceParticipantState(Guid UserId, Guid ChannelId, bool Muted);

public sealed record VoiceParticipantSnapshot(
    long Sequence,
    IReadOnlyList<VoiceParticipantState> Participants);

public sealed record VoiceDisplacement(string ConnectionId, Guid ChannelId);

public sealed record VoiceJoinResult(
    Guid? PreviousChannelId,
    IReadOnlyList<VoiceDisplacement> Displaced,
    bool Accepted = true);

public sealed record VoiceMoveResult(IReadOnlyList<string> ConnectionIds, bool Moved);

/// <summary>
/// Process-local state of the authenticated hub connections and of who sits
/// in which voice room.
/// </summary>
/// <remarks>
/// Presence belongs to a user, while a voice seat belongs to one concrete
/// connection. A newer tab takes the seat of an older one, because the
/// signalling protocol names peers by user id and cannot hold two of them.
/// </remarks>
public sealed class PresenceTracker
{
    public const string Online = "online";
    public const string Idle = "idle";
    public const string DoNotDisturb = "dnd";
    public const string Offline = "offline";

    private static readonly FrozenSet<string> KnownPresences =
        FrozenSet.ToFrozenSet([Online, Idle, DoNotDisturb, Offline], StringComparer.Ordinal);

    private readonly Lock _gate = new();
    private readonly Dictionary<string, Guid> _userByConnection = new(StringComparer.Ordinal);
    private readonly Dictionary<Guid, HashSet<string>> _connectionsByUser = [];
    private readonly Dictionary<Guid, string> _chosenPresence = [];
    private readonly Dictionary<Guid, bool> _presenceVisible = [];
    private readonly Dictionary<string, Seat> _seatByConnection = new(StringComparer.Ordinal);
    private long _snapshotSequence;

    public static bool IsSupportedPresence(string value) => KnownPresences.Contains(value);

    /// <summary>Registers a hub connection; true means the account just came online.</summary>
    public bool Connect(string connectionId, Guid userId, bool showPresence = true)
    {
        lock (_gate)
        {
            if (_userByConnection.TryGetValue(connectionId, out var owner))
            {
                if (owner != userId)
                {
                    throw new InvalidOperationException("A connection cannot change users.");
                }
                return false;
            }

            _userByConnection[connectionId] = userId;
            if (!_connectionsByUser.TryGetValue(userId, out var connections))
            {
                connections = new HashSet<string>(StringComparer.Ordinal);
                _connectionsByUser[userId] = connections;
            }
            connections.Add(connectionId);

            _chosenPresence.TryAdd(userId, Online);
            _presenceVisible[userId] = showPresence;
            return connections.Count == 1;
        }
    }

    /// <summary>
    /// Forgets a connection and frees the voice seat it held. BecameOffline is
    /// true when it was the account's last connection.
    /// </summary>
    public (bool BecameOffline, VoiceDeparture? VoiceDeparture) Disconnect(string connectionId)
    {
        lock (_gate)
        {
            if (!_userByConnection.Remove(connectionId, out var userId))
            {
                return (false, null);
            }

            var connections = _connectionsByUser[userId];
            connections.Remove(connectionId);
            var becameOffline = connections.Count == 0;
            if (becameOffline)
            {
                _connectionsByUser.Remove(userId);
            }

            return (becameOffline, TakeSeat(connectionId));
        }
    }

    /// <summary>
    /// Sets the status an online account advertises on all its connections.
    /// True means observers need to hear about it.
    /// </summary>
    public bool SetPresence(Guid userId, string value)
    {
        if (!IsSupportedPresence(value))
        {
            throw new ArgumentOutOfRangeException(nameof(value), value, "Unsupported presence.");
        }

        lock (_gate)
        {
            if (!_connectionsByUser.ContainsKey(userId))
            {
                return false;
            }

            var changed = ChosenLocked(userId) != value;
            _chosenPresence[userId] = value;
            return changed;
        }
    }

    /// <summary>Changes whether other accounts may see the real status; true when it matters now.</summary>
    public bool SetVisibility(Guid userId, bool showPresence)
    {
        lock (_gate)
        {
            var changed = _presenceVisible.GetValueOrDefault(userId, true) != showPresence;
            _presenceVisible[userId] = showPresence;
            return changed && _connectionsByUser.ContainsKey(userId);
        }
    }

    /// <summary>The account's own view of its status; being disconnected wins over any choice.</summary>
    public string PresenceOf(Guid userId)
    {
        lock (_gate)
        {
            return PresenceLocked(userId);
        }
    }

    /// <summary>The status <paramref name="viewerId"/> may see; hidden accounts read as offline to others.</summary>
    public string PublicPresenceOf(Guid userId, Guid? viewerId = null)
    {
        lock (_gate)
        {
            var hidden = viewerId != userId && !_presenceVisible.GetValueOrDefault(userId, true);
            return hidden ? Offline : PresenceLocked(userId);
        }
    }

    public IReadOnlyList<string> ConnectionIds(Guid userId)
    {
        lock (_gate)
        {
            return _connectionsByUser.TryGetValue(userId, out var connections) ? [.. connections] : [];
        }
    }

    /// <summary>
    /// Seats this connection in a voice room, displacing the account's other
    /// connections wherever they sat. A room at its <paramref name="userLimit"/>
    /// (0 means unlimited) refuses newcomers, but not an account already in it.
    /// </summary>
    public VoiceJoinResult JoinVoice(string connectionId, Guid userId, Guid channelId, int userLimit = 0)
    {
        lock (_gate)
        {
            if (!_userByConnection.TryGetValue(connectionId, out var owner) || owner != userId)
            {
                throw new InvalidOperationException("Only a connected user can join voice.");
            }

            var occupants = _seatByConnection.Values
                .Where(seat => seat.ChannelId == channelId)
                .Select(seat => seat.UserId)
                .Distinct()
                .ToArray();
            if (userLimit > 0 && occupants.Length >= userLimit && !occupants.Contains(userId))
            {
                return new VoiceJoinResult(null, [], Accepted: false);
            }

            var displaced = _seatByConnection
                .Where(entry => entry.Key != connectionId && entry.Value.UserId == userId)
                .Select(entry => new VoiceDisplacement(entry.Key, entry.Value.ChannelId))
                .ToArray();
            foreach (var seat in displaced)
            {
                _seatByConnection.Remove(seat.ConnectionId);
            }

            _seatByConnection.TryGetValue(connectionId, out var current);
            var keepsMute = current is { } held && held.ChannelId == channelId && held.Muted;
            _seatByConnection[connectionId] = new Seat(userId, channelId, keepsMute);
            return new VoiceJoinResult(
                current is { } left && left.ChannelId != channelId ? left.ChannelId : null,
                displaced);
        }
    }

    public VoiceDeparture? LeaveVoice(string connectionId)
    {
        lock (_gate)
        {
            return TakeSeat(connectionId);
        }
    }

    /// <summary>
    /// Frees every seat the account holds in the given server channels. Direct
    /// calls are not touched: being removed from a server ends no friendship.
    /// </summary>
    public IReadOnlyList<VoiceDeparture> RemoveUserFromVoiceChannels(
        Guid userId,
        IReadOnlySet<Guid> channelIds)
    {
        lock (_gate)
        {
            var connectionIds = _seatByConnection
                .Where(entry => entry.Value.UserId == userId && channelIds.Contains(entry.Value.ChannelId))
                .Select(entry => entry.Key)
                .ToArray();
            return [.. connectionIds.Select(TakeSeat).OfType<VoiceDeparture>()];
        }
    }

    /// <summary>
    /// Moves every seat the account holds in one room to another. Connection
    /// and mute state stay as they are; the client is told to rebuild its
    /// peers.
    /// </summary>
    public VoiceMoveResult MoveUserBetweenVoiceChannels(Guid userId, Guid sourceChannelId, Guid targetChannelId)
    {
        lock (_gate)
        {
            var connectionIds = SeatConnectionsLocked(seat => seat.UserId == userId && seat.ChannelId == sourceChannelId);
            foreach (var connectionId in connectionIds)
            {
                _seatByConnection[connectionId] = _seatByConnection[connectionId] with { ChannelId = targetChannelId };
            }

            return new VoiceMoveResult(connectionIds, connectionIds.Length > 0);
        }
    }

    public bool IsConnectionInVoice(string connectionId, Guid channelId)
    {
        lock (_gate)
        {
            return _seatByConnection.TryGetValue(connectionId, out var seat) && seat.ChannelId == channelId;
        }
    }

    public void SetVoiceMuted(string connectionId, bool muted)
    {
        lock (_gate)
        {
            if (_seatByConnection.TryGetValue(connectionId, out var seat))
            {
                _seatByConnection[connectionId] = seat with { Muted = muted };
            }
        }
    }

    /// <summary>The account's connections that actually sit in this room.</summary>
    public IReadOnlyList<string> VoiceConnectionIds(Guid userId, Guid channelId)
    {
        lock (_gate)
        {
            return SeatConnectionsLocked(seat => seat.UserId == userId && seat.ChannelId == channelId);
        }
    }

    /// <summary>Every connection that sits in this room.</summary>
    public IReadOnlyList<string> VoiceConnectionIds(Guid channelId)
    {
        lock (_gate)
        {
            return SeatConnectionsLocked(seat => seat.ChannelId == channelId);
        }
    }

    /// <summary>Every room with at least one seat taken.</summary>
    public IReadOnlyList<Guid> ActiveVoiceRoomIds()
    {
        lock (_gate)
        {
            return [.. _seatByConnection.Values.Select(seat => seat.ChannelId).Distinct()];
        }
    }

    /// <summary>Empties a room, as when a two-person call is declined; returns the connections that sat in it.</summary>
    public IReadOnlyList<string> EndVoiceRoom(Guid channelId)
    {
        lock (_gate)
        {
            var connectionIds = SeatConnectionsLocked(seat => seat.ChannelId == channelId);
            foreach (var connectionId in connectionIds)
            {
                _seatByConnection.Remove(connectionId);
            }
            return connectionIds;
        }
    }

    /// <summary>One row per account, which <see cref="JoinVoice"/> keeps true even when two tabs race.</summary>
    public IReadOnlyList<VoiceParticipantState> VoiceUsers(Guid channelId)
    {
        lock (_gate)
        {
            return OccupantsLocked(channelId);
        }
    }

    /// <summary>
    /// One ordered occupancy frame of a room. Lookups and sends that follow
    /// run outside the lock and may finish out of order, so the sequence lets
    /// a client drop a stale frame instead of tearing down live peers.
    /// </summary>
    public VoiceParticipantSnapshot VoiceSnapshot(Guid channelId)
    {
        lock (_gate)
        {
            return new VoiceParticipantSnapshot(++_snapshotSequence, OccupantsLocked(channelId));
        }
    }

    private string ChosenLocked(Guid userId) => _chosenPresence.GetValueOrDefault(userId, Online);

    private string PresenceLocked(Guid userId) =>
        _connectionsByUser.ContainsKey(userId) ? ChosenLocked(userId) : Offline;

    private VoiceDeparture? TakeSeat(string connectionId) =>
        _seatByConnection.Remove(connectionId, out var seat)
            ? new VoiceDeparture(seat.UserId, seat.ChannelId)
            : null;

    private string[] SeatConnectionsLocked(Func<Seat, bool> predicate) =>
        [.. _seatByConnection.Where(entry => predicate(entry.Value)).Select(entry => entry.Key)];

    private VoiceParticipantState[] OccupantsLocked(Guid channelId) =>
        [.. _seatByConnection.Values
            .Where(seat => seat.ChannelId == channelId)
            .Select(seat => new VoiceParticipantState(seat.UserId, channelId, seat.Muted))
            .OrderBy(participant => participant.UserId)];

    private sealed record Seat(Guid UserId, Guid ChannelId, bool Muted);
}
