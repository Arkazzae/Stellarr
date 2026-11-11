using Microsoft.AspNetCore.SignalR;
using Stellarr.Api.Logging;

namespace Stellarr.Api.Realtime;

/// <summary>
/// Delivers what the media plane tells a browser: <c>MediaSignal</c> and
/// <c>MediaSessionClosed</c>. This is the one place that knows their shape on
/// the wire.
/// </summary>
/// <remarks>
/// Deliveries to one connection run one after another, in the order they were
/// posted, and never two at a time; the negotiation of a session depends on
/// that order. Each connection has its own line, so a browser that is slow to
/// take its messages holds up only itself. Posting never waits, which lets
/// the event pump and the hub post while they hold a lock or the media gate.
/// </remarks>
public sealed class MediaEventOutbox(IHubContext<AppHub> hub, ILogger<MediaEventOutbox> logger)
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, Task> _lines = new(StringComparer.Ordinal);

    /// <summary>One signal of the media server, whose payload object travels as a JSON string.</summary>
    public void PostSignal(SeatedMediaSession to, string kind, string payload) =>
        Post(to.ConnectionId, "MediaSignal", new
        {
            protocolVersion = RtcProtocol.Version,
            channelId = to.ChannelId.ToString(),
            sessionId = to.Session.SessionId,
            kind,
            payload,
        });

    /// <summary>The media plane ended a session that its seat still needed.</summary>
    public void PostClosed(SeatedMediaSession to, string reason) =>
        Post(to.ConnectionId, "MediaSessionClosed", new
        {
            channelId = to.ChannelId.ToString(),
            sessionId = to.Session.SessionId,
            reason,
        });

    /// <summary>Completes once everything posted so far has been handed to SignalR.</summary>
    internal Task DrainAsync()
    {
        lock (_gate)
        {
            return Task.WhenAll(_lines.Values);
        }
    }

    private void Post(string connectionId, string method, object message)
    {
        lock (_gate)
        {
            var previous = _lines.GetValueOrDefault(connectionId) ?? Task.CompletedTask;
            var next = SendAfterAsync(previous, connectionId, method, message);
            _lines[connectionId] = next;
            next.ContinueWith(done => Retire(connectionId, done), TaskScheduler.Default);
        }
    }

    private async Task SendAfterAsync(Task previous, string connectionId, string method, object message)
    {
        // A line never fails: every send below catches its own error.
        await previous;
        // Off the poster's thread, which may hold a lock.
        await Task.Yield();
        try
        {
            await hub.Clients.Client(connectionId).SendAsync(method, message);
        }
        catch (Exception exception)
        {
            // The connection is going away; its seat and session go with it.
            MediaLog.DeliveryFailed(logger, exception, method, connectionId);
        }
    }

    /// <summary>Forgets a connection's line once nothing waits on it, so idle connections cost nothing.</summary>
    private void Retire(string connectionId, Task finished)
    {
        lock (_gate)
        {
            if (_lines.TryGetValue(connectionId, out var line) && line == finished)
            {
                _lines.Remove(connectionId);
            }
        }
    }
}
