using Stellarr.Api.Logging;

namespace Stellarr.Api.Realtime;

/// <summary>How an attempt to open a media session ended.</summary>
public enum MediaOpeningStatus
{
    Opened,

    /// <summary>The seat ended while the media server was creating the session.</summary>
    NotSeated,

    /// <summary>The media server could not be reached, or the API is putting it back in step.</summary>
    Unavailable,
}

public readonly record struct MediaOpening(MediaOpeningStatus Status, string? SessionId = null);

/// <summary>
/// The API's side of the media plane: whether it is in step with the media
/// server, and the one gate that keeps the creation of a session apart from
/// the moments in which sessions are forgotten or events handed out.
/// </summary>
/// <remarks>
/// The gate closes two gaps. An event of a session that the media server has
/// just created may come back on the long poll before the hub has given the
/// session to its seat; under the gate the pump hands it out only once the
/// seat holds it. And <c>POST /v1/reset</c> ends every session, including one
/// created a moment before, which the epoch of a session cannot reveal because
/// a reset keeps the epoch; under the gate no session is being created while a
/// reset runs. Signals and closes do not take the gate.
/// </remarks>
public sealed class MediaPlane(
    PresenceTracker presence,
    IMediaSessionCloser closer,
    MediaControlClient control,
    MediaEventOutbox outbox,
    MediaControlTiming timing,
    ILogger<MediaPlane> logger) : IDisposable
{
    public const string MediaRestarted = "media-restarted";

    private readonly SemaphoreSlim _gate = new(1, 1);
    private volatile bool _ready;

    /// <summary>
    /// True once the API has reset the media server and until it finds that
    /// it lost track of the media server's events. Sessions are only created
    /// in between.
    /// </summary>
    public bool IsReady
    {
        get => _ready;
        internal set => _ready = value;
    }

    /// <summary>
    /// Creates the media session of the connection's seat in
    /// <paramref name="roomId"/>, after closing, silently, the session the
    /// connection held before.
    /// </summary>
    public async Task<MediaOpening> OpenAsync(string connectionId, Guid roomId, Guid userId)
    {
        presence.CloseMediaSession(connectionId);

        // A hub call must not hang on a pump that is stuck behind a slow
        // media server, so the wait is as long as a command may take.
        if (!await _gate.WaitAsync(timing.CommandTimeout))
        {
            return new MediaOpening(MediaOpeningStatus.Unavailable);
        }

        try
        {
            if (!IsReady)
            {
                return new MediaOpening(MediaOpeningStatus.Unavailable);
            }

            MediaSessionCreated created;
            try
            {
                created = await control.CreateSessionAsync(roomId, userId, CancellationToken.None);
            }
            catch (MediaServerUnavailableException exception)
            {
                MediaLog.OpenFailed(logger, exception);
                return new MediaOpening(MediaOpeningStatus.Unavailable);
            }

            var session = new MediaSession(created.SessionId, created.Epoch);
            if (presence.AttachMediaSession(connectionId, roomId, session))
            {
                return new MediaOpening(MediaOpeningStatus.Opened, session.SessionId);
            }

            closer.Close(session);
            return new MediaOpening(MediaOpeningStatus.NotSeated);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Forgets a session the media server no longer has, as a <c>404
    /// unknown-session</c> on a signal shows, and tells its browser.
    /// </summary>
    public void LoseSession(string sessionId)
    {
        if (presence.ForgetMediaSession(sessionId) is { } lost)
        {
            outbox.PostClosed(lost, MediaRestarted);
        }
    }

    /// <summary>Waits for the gate, for the event pump; see the remarks of the class.</summary>
    internal async Task<IDisposable> EnterAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        return new Turn(_gate);
    }

    /// <summary>
    /// Forgets every session <paramref name="ended"/> picks, which the media
    /// server lost when it restarted or was reset, and tells their browsers.
    /// </summary>
    internal void EndSessions(Func<MediaSession, bool> ended)
    {
        foreach (var session in presence.ForgetMediaSessions(ended))
        {
            outbox.PostClosed(session, MediaRestarted);
        }
    }

    public void Dispose() => _gate.Dispose();

    private sealed class Turn(SemaphoreSlim gate) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                gate.Release();
            }
        }
    }
}
