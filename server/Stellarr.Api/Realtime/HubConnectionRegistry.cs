using System.Collections.Concurrent;

namespace Stellarr.Api.Realtime;

/// <summary>
/// The live hub connections of this process, keyed by the authenticated session
/// they carry. Aborting is what actually ends the WebSocket; the ordinary
/// disconnect lifecycle then leaves voice and media through PresenceTracker.
/// </summary>
public sealed class HubConnectionRegistry
{
    private sealed record Entry(Guid UserId, Guid SessionId, int SecurityVersion, Action Abort);

    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.Ordinal);

    public void Register(string connectionId, Guid userId, Guid sessionId, int securityVersion, Action abort) =>
        _entries[connectionId] = new Entry(userId, sessionId, securityVersion, abort);

    public void Unregister(string connectionId) => _entries.TryRemove(connectionId, out _);

    public IReadOnlyList<LiveHubConnection> Snapshot() =>
        _entries.Select(entry => new LiveHubConnection(
                entry.Key,
                entry.Value.UserId,
                entry.Value.SessionId,
                entry.Value.SecurityVersion,
                entry.Value.Abort))
            .ToArray();

    public int Count => _entries.Count;

    public void AbortSession(Guid sessionId)
    {
        foreach (var (connectionId, entry) in _entries)
        {
            if (entry.SessionId == sessionId)
            {
                entry.Abort();
                _entries.TryRemove(connectionId, out _);
            }
        }
    }

    public void AbortUser(Guid userId)
    {
        foreach (var (connectionId, entry) in _entries)
        {
            if (entry.UserId == userId)
            {
                entry.Abort();
                _entries.TryRemove(connectionId, out _);
            }
        }
    }

    public void AbortAll()
    {
        foreach (var (connectionId, entry) in _entries)
        {
            entry.Abort();
            _entries.TryRemove(connectionId, out _);
        }
    }
}

public sealed record LiveHubConnection(
    string ConnectionId,
    Guid UserId,
    Guid SessionId,
    int SecurityVersion,
    Action Abort);
