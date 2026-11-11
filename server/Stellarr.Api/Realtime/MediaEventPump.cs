using System.Text.Json;
using Stellarr.Api.Logging;

namespace Stellarr.Api.Realtime;

/// <summary>
/// Follows the media server's events and hands them to the browsers whose
/// seats hold the sessions: a <c>signal</c> becomes <c>MediaSignal</c>, a
/// <c>closed</c> session <c>MediaSessionClosed</c>.
/// </summary>
/// <remarks>
/// <para>
/// The API starts with no seats, so the pump first resets the media server.
/// It then long-polls the events of that run of the media server, in order,
/// and remembers the last sequence number it handed out.
/// </para>
/// <para>
/// A new epoch means the media server restarted and lost its sessions: the
/// sessions of every other epoch end, while one already opened in the new
/// epoch stays. When the media server no longer keeps the events the pump
/// asks for, nothing tells which sessions they concerned, so the pump resets
/// the media server again and ends them all. While the media server cannot be
/// reached the pump tries again after a pause, and treats the first answer
/// that follows as a possible new epoch.
/// </para>
/// </remarks>
public sealed class MediaEventPump(
    MediaControlClient control,
    MediaPlane plane,
    PresenceTracker presence,
    MediaEventOutbox outbox,
    MediaControlTiming timing,
    ILogger<MediaEventPump> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // The host goes on starting while the first reset waits for a media
        // server that may not be up yet.
        await Task.Yield();

        string? epoch = null;
        long after = 0;
        var failing = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (epoch is not { } current)
                {
                    (epoch, after) = await ResetAsync(stoppingToken);
                }
                else
                {
                    var batch = await control.GetEventsAsync(current, after, stoppingToken);
                    using (await plane.EnterAsync(stoppingToken))
                    {
                        (epoch, after) = Take(batch, current, after, afterOutage: failing);
                    }
                }

                if (failing)
                {
                    MediaLog.ControlAvailable(logger);
                    failing = false;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                // A refusal, a timeout and a bug all get the same pause, so a
                // media server in a bad state is never polled in a tight loop.
                if (!failing)
                {
                    MediaLog.ControlUnavailable(logger, exception);
                    failing = true;
                }

                try
                {
                    await Task.Delay(timing.RetryPause, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    /// <summary>Resets the media server, ends every session the API knew of, and returns where the events start.</summary>
    private async Task<(string Epoch, long After)> ResetAsync(CancellationToken cancellationToken)
    {
        // Set before waiting for the gate, so no new session starts behind
        // the reset only to be lost in it.
        plane.IsReady = false;
        using (await plane.EnterAsync(cancellationToken))
        {
            var reset = await control.ResetAsync(cancellationToken);
            plane.EndSessions(_ => true);
            plane.IsReady = true;
            MediaLog.Reset(logger, reset.Epoch, reset.Seq);
            return (reset.Epoch, reset.Seq);
        }
    }

    /// <summary>
    /// Handles one answer of the long poll and returns the epoch and sequence
    /// number to poll from next; a null epoch asks for a reset. Runs under the
    /// media gate.
    /// </summary>
    private (string? Epoch, long After) Take(MediaEventBatch batch, string epoch, long after, bool afterOutage)
    {
        if (batch.Reset && batch.Epoch == epoch)
        {
            plane.IsReady = false;
            MediaLog.EventsLost(logger, after);
            return (null, 0);
        }

        var restarted = batch.Reset || batch.Epoch != epoch;
        if (restarted || afterOutage)
        {
            plane.EndSessions(session => session.Epoch != batch.Epoch);
        }

        if (restarted)
        {
            // A reset answer carries no events; an answer from another run
            // without the flag is read the same way rather than trusted.
            MediaLog.Restarted(logger, batch.Epoch);
            return (batch.Epoch, 0);
        }

        foreach (var media in batch.Events)
        {
            if (media.Seq <= after)
            {
                continue;
            }

            Deliver(media);
            after = media.Seq;
        }
        return (epoch, after);
    }

    private void Deliver(MediaEvent media)
    {
        switch (media.Type)
        {
            case "signal" when media.Kind is { } kind &&
                RtcProtocol.MediaServerSignalKinds.Contains(kind) &&
                media.Payload.ValueKind == JsonValueKind.Object:
                // A session that no seat holds any more has nobody to tell.
                if (presence.FindMediaSession(media.SessionId) is { } seated)
                {
                    outbox.PostSignal(seated, kind, media.Payload.GetRawText());
                }
                break;

            case "closed":
                // Only the path that takes the session off its seat tells the
                // browser, so a session that the hub already found lost, or
                // whose seat ended, is not reported twice.
                if (presence.ForgetMediaSession(media.SessionId) is { } ended)
                {
                    outbox.PostClosed(ended, media.Reason is "transport-timeout" ? "transport-timeout" : "error");
                }
                break;

            default:
                MediaLog.EventIgnored(logger, media.Seq, media.Type, media.Kind);
                break;
        }
    }
}
