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

/// <summary>A session of the media server: its opaque id and the run of the media server that created it.</summary>
public sealed record MediaSession(string SessionId, string Epoch);

/// <summary>A media session and the seat that holds it.</summary>
public sealed record SeatedMediaSession(string ConnectionId, Guid ChannelId, MediaSession Session);

/// <summary>
/// Closes, in the media server, the sessions whose seat ended. The tracker
/// calls it while it holds its own lock, so an implementation only takes note
/// and returns; it never waits and never calls back into the tracker.
/// </summary>
public interface IMediaSessionCloser
{
    void Close(MediaSession session);
}

/// <summary>
/// Process-local state of the authenticated hub connections, of who sits
/// in which voice room and of the media session each seat holds.
/// </summary>
/// <remarks>
/// Presence belongs to a user, while a voice seat belongs to one concrete
/// connection. A newer tab takes the seat of an older one, because the
/// signalling protocol names peers by user id and cannot hold two of them.
/// <para>
/// A seat also holds the session the media server keeps
/// for it, and the session lives exactly as long as the seat stays in its
/// room. That rule is kept here rather than by the hub methods and endpoints
/// that move people around: every change of a seat goes through
/// <see cref="SetSeatLocked"/>, which hands the session it ends to the
/// <see cref="IMediaSessionCloser"/>. A new way of ending a seat therefore
/// cannot forget to stop the media.
/// </para>
/// </remarks>
public sealed class PresenceTracker(IMediaSessionCloser? mediaSessionCloser = null)
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

    /// <summary>Open hub connections of every account, on every server.</summary>
    public int ConnectionCount()
    {
        lock (_gate)
        {
            return _userByConnection.Count;
        }
    }

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
                SetSeatLocked(seat.ConnectionId, null);
            }

            // Joining the room the connection already sits in keeps the seat
            // as it is, its mute state and its media session included.
            _seatByConnection.TryGetValue(connectionId, out var current);
            if (current is null || current.ChannelId != channelId)
            {
                SetSeatLocked(connectionId, new Seat(userId, channelId, Muted: false));
            }
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
                SetSeatLocked(connectionId, _seatByConnection[connectionId] with { ChannelId = targetChannelId });
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
                SetSeatLocked(connectionId, seat with { Muted = muted });
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
                SetSeatLocked(connectionId, null);
            }
            return connectionIds;
        }
    }

    /// <summary>
    /// Gives the connection's seat in <paramref name="channelId"/> its media
    /// session, closing one it held before. False when the connection no
    /// longer sits there, which happens when the seat ended while the media
    /// server was creating the session; the caller then closes the session.
    /// </summary>
    public bool AttachMediaSession(string connectionId, Guid channelId, MediaSession session)
    {
        lock (_gate)
        {
            if (!_seatByConnection.TryGetValue(connectionId, out var seat) || seat.ChannelId != channelId)
            {
                return false;
            }

            SetSeatLocked(connectionId, seat with { Media = session });
            return true;
        }
    }

    /// <summary>Closes the media session the connection's seat holds, if it holds one; the seat stays.</summary>
    public void CloseMediaSession(string connectionId)
    {
        lock (_gate)
        {
            if (_seatByConnection.TryGetValue(connectionId, out var seat) && seat.Media is not null)
            {
                SetSeatLocked(connectionId, seat with { Media = null });
            }
        }
    }

    /// <summary>The media session of the connection's seat in this room; null without a seat there or without a session.</summary>
    public MediaSession? MediaSessionOf(string connectionId, Guid channelId)
    {
        lock (_gate)
        {
            return _seatByConnection.TryGetValue(connectionId, out var seat) && seat.ChannelId == channelId
                ? seat.Media
                : null;
        }
    }

    /// <summary>The seat that holds a media session, which is where its signals go; null when none does.</summary>
    public SeatedMediaSession? FindMediaSession(string sessionId)
    {
        lock (_gate)
        {
            foreach (var (connectionId, seat) in _seatByConnection)
            {
                if (seat.Media is { } media && media.SessionId == sessionId)
                {
                    return new SeatedMediaSession(connectionId, seat.ChannelId, media);
                }
            }
            return null;
        }
    }

    /// <summary>
    /// Takes a media session off its seat without closing it, because the
    /// media plane already ended it. Null when no seat holds it any more: of
    /// two paths that learn about the same end, only the first one gets it and
    /// tells the browser.
    /// </summary>
    public SeatedMediaSession? ForgetMediaSession(string sessionId) =>
        ForgetMediaSessions(media => media.SessionId == sessionId) is [var forgotten, ..] ? forgotten : null;

    /// <summary>Takes every media session <paramref name="ended"/> picks off its seat without closing it.</summary>
    public IReadOnlyList<SeatedMediaSession> ForgetMediaSessions(Func<MediaSession, bool> ended)
    {
        lock (_gate)
        {
            var forgotten = _seatByConnection
                .Where(entry => entry.Value.Media is { } media && ended(media))
                .Select(entry => new SeatedMediaSession(entry.Key, entry.Value.ChannelId, entry.Value.Media!))
                .ToArray();
            // Written directly rather than through SetSeatLocked: the session
            // is gone from the media server, and closing it there again would
            // only be one more request to a process that may be down.
            foreach (var session in forgotten)
            {
                _seatByConnection[session.ConnectionId] = _seatByConnection[session.ConnectionId] with { Media = null };
            }
            return forgotten;
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

    private VoiceDeparture? TakeSeat(string connectionId)
    {
        if (!_seatByConnection.TryGetValue(connectionId, out var seat))
        {
            return null;
        }

        SetSeatLocked(connectionId, null);
        return new VoiceDeparture(seat.UserId, seat.ChannelId);
    }

    /// <summary>
    /// The one way a seat is written, null meaning that it ends. A media
    /// session that the seat no longer holds afterwards, because the seat
    /// ended, moved to another room or took a newer session, is handed to the
    /// closer.
    /// </summary>
    private void SetSeatLocked(string connectionId, Seat? next)
    {
        _seatByConnection.TryGetValue(connectionId, out var current);
        if (next is not null && next.ChannelId != current?.ChannelId)
        {
            // A session belongs to one room; the client opens a new one in the next.
            next = next with { Media = null };
        }

        if (current?.Media is { } media && media != next?.Media)
        {
            mediaSessionCloser?.Close(media);
        }

        if (next is null)
        {
            _seatByConnection.Remove(connectionId);
        }
        else
        {
            _seatByConnection[connectionId] = next;
        }
    }

    private string[] SeatConnectionsLocked(Func<Seat, bool> predicate) =>
        [.. _seatByConnection.Where(entry => predicate(entry.Value)).Select(entry => entry.Key)];

    private VoiceParticipantState[] OccupantsLocked(Guid channelId) =>
        [.. _seatByConnection.Values
            .Where(seat => seat.ChannelId == channelId)
            .Select(seat => new VoiceParticipantState(seat.UserId, channelId, seat.Muted))
            .OrderBy(participant => participant.UserId)];

    private sealed record Seat(Guid UserId, Guid ChannelId, bool Muted, MediaSession? Media = null);
}
