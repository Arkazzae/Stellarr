using Stellarr.Api.Logging;

namespace Stellarr.Api.Realtime;

/// <summary>
/// Closes, in the media server, the sessions whose seats ended. A seat ends at
/// once and in memory; the request to the media server follows from here, so
/// neither a database lookup nor a media server that is down can keep a person
/// seated.
/// </summary>
/// <remarks>
/// A close that fails is tried again after a pause until the media server
/// takes it. Giving up would leave a person who was kicked receiving media,
/// and closing a session the media server no longer has is harmless: it
/// answers 204 for an unknown session too.
/// </remarks>
public sealed class MediaSessionCloser(
    MediaTopology topology,
    IServiceProvider services,
    MediaControlTiming timing,
    ILogger<MediaSessionCloser> logger) : BackgroundService, IMediaSessionCloser
{
    /// <summary>
    /// More closes than this only pile up while the control API refuses every
    /// request, and then the oldest ones are the least likely to still matter.
    /// </summary>
    private const int MaxPending = 4096;

    private readonly Lock _gate = new();
    private readonly Queue<MediaSession> _pending = new();
    private readonly SemaphoreSlim _queued = new(0);

    /// <summary>Sessions waiting to be closed, for the tests and for diagnostics.</summary>
    internal int PendingCount
    {
        get
        {
            lock (_gate)
            {
                return _pending.Count;
            }
        }
    }

    public void Close(MediaSession session)
    {
        lock (_gate)
        {
            if (_pending.Count >= MaxPending)
            {
                MediaLog.CloseDropped(logger, _pending.Dequeue().SessionId);
            }
            else
            {
                _queued.Release();
            }
            _pending.Enqueue(session);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Nothing is ever queued in the mesh topology, where no seat holds a
        // media session; returning keeps the media server out of it entirely.
        if (!topology.IsSfu)
        {
            return;
        }

        var control = services.GetRequiredService<MediaControlClient>();
        var failing = false;
        try
        {
            while (true)
            {
                await _queued.WaitAsync(stoppingToken);
                MediaSession? session;
                lock (_gate)
                {
                    _pending.TryPeek(out session);
                }
                if (session is null)
                {
                    continue;
                }

                try
                {
                    await control.CloseSessionAsync(session.SessionId, stoppingToken);
                    if (failing)
                    {
                        MediaLog.ClosingResumed(logger);
                        failing = false;
                    }
                    lock (_gate)
                    {
                        // The overflow rule may have dropped it meanwhile.
                        if (_pending.TryPeek(out var head) && ReferenceEquals(head, session))
                        {
                            _pending.Dequeue();
                        }
                        else
                        {
                            _queued.Release();
                        }
                    }
                }
                catch (Exception exception) when (exception is not OperationCanceledException ||
                    !stoppingToken.IsCancellationRequested)
                {
                    // Whatever went wrong, the loop has to survive it: a
                    // background service that throws stops the whole host.
                    if (!failing)
                    {
                        MediaLog.CloseFailed(logger, exception, session.SessionId);
                        failing = true;
                    }
                    _queued.Release();
                    await Task.Delay(timing.RetryPause, stoppingToken);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The host is stopping. Sessions still queued die with the media
            // server's own reset when the API starts again.
        }
    }
}
