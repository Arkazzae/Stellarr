using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Realtime;

/// <summary>The answer to <c>POST /v1/reset</c>: the run of the media server and the last sequence number it issued.</summary>
public sealed record MediaResetResult(string Epoch, long Seq);

/// <summary>The answer to <c>POST /v1/sessions</c>.</summary>
public sealed record MediaSessionCreated(string SessionId, string Epoch);

/// <summary>One answer of the event long poll.</summary>
public sealed record MediaEventBatch(string Epoch, bool Reset, IReadOnlyList<MediaEvent> Events);

/// <summary>
/// One event of the media plane: a <c>signal</c> for a browser, which carries
/// <see cref="Kind"/> and <see cref="Payload"/>, or a <c>closed</c> session,
/// which carries <see cref="Reason"/>.
/// </summary>
public sealed record MediaEvent(long Seq, string Type, string SessionId, string? Kind, JsonElement Payload, string? Reason);

/// <summary>How the media server took a browser's signal.</summary>
public enum MediaSignalOutcome
{
    Accepted,

    /// <summary><c>404 unknown-session</c>: the media server no longer has the session.</summary>
    UnknownSession,

    /// <summary><c>409 stale-negotiation</c>: an answer to an offer the media server has already given up.</summary>
    Stale,

    /// <summary><c>422</c>, or <c>413</c> for a body over 256 KiB: the description or the candidate was refused.</summary>
    Refused,
}

/// <summary>The media server could not be reached, did not answer in time, or answered in a way the API cannot use.</summary>
public sealed class MediaServerUnavailableException : Exception
{
    public MediaServerUnavailableException()
    {
    }

    public MediaServerUnavailableException(string message) : base(message)
    {
    }

    public MediaServerUnavailableException(string message, Exception innerException) : base(message, innerException)
    {
    }
}

/// <summary>
/// How long the API waits for the media server. Commands run on the path of a
/// hub call or of a seat change, so they get a short limit; the event poll
/// waits by design and gets the media server's own wait plus a margin.
/// </summary>
public sealed class MediaControlTiming
{
    public TimeSpan CommandTimeout { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>The <c>waitMs</c> of the event poll; the media server caps it at 30000.</summary>
    public int EventWaitMs { get; init; } = 25_000;

    /// <summary>The pause before the next attempt after the media server failed to answer.</summary>
    public TimeSpan RetryPause { get; init; } = TimeSpan.FromSeconds(2);
}

/// <summary>
/// The client of the media server's control API. <see cref="AppHub"/> is its
/// only user, through the hub itself, the event pump and the closer of
/// sessions.
/// </summary>
/// <remarks>
/// Every failure to get a usable answer becomes a
/// <see cref="MediaServerUnavailableException"/>, so the callers have one
/// thing to catch and a slow or broken media server never surfaces as an
/// unexpected error in a hub call.
/// </remarks>
public sealed class MediaControlClient(
    IHttpClientFactory httpClients,
    MediaServerSettings settings,
    MediaControlTiming timing)
{
    /// <summary>The named HTTP client that carries the base address and the connection settings.</summary>
    public const string HttpClientName = "media-control";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Closes every session without events, as the API does when it starts or loses track of the events.</summary>
    public Task<MediaResetResult> ResetAsync(CancellationToken cancellationToken) =>
        CallAsync(
            HttpMethod.Post,
            "v1/reset",
            body: null,
            timing.CommandTimeout,
            async (response, token) =>
            {
                Expect(response, HttpStatusCode.OK);
                var reset = await response.Content.ReadFromJsonAsync<MediaResetResult>(Json, token);
                return reset is { Epoch.Length: > 0, Seq: >= 0 } ? reset : throw Malformed("v1/reset");
            },
            cancellationToken);

    public Task<MediaSessionCreated> CreateSessionAsync(Guid roomId, Guid userId, CancellationToken cancellationToken) =>
        CallAsync(
            HttpMethod.Post,
            "v1/sessions",
            new { roomId, userId },
            timing.CommandTimeout,
            async (response, token) =>
            {
                Expect(response, HttpStatusCode.Created);
                var created = await response.Content.ReadFromJsonAsync<MediaSessionCreated>(Json, token);
                return created is { SessionId.Length: > 0, Epoch.Length: > 0 } ? created : throw Malformed("v1/sessions");
            },
            cancellationToken);

    /// <summary>Closes one session. A session the media server does not know is as closed as it gets.</summary>
    public Task CloseSessionAsync(string sessionId, CancellationToken cancellationToken) =>
        CallAsync(
            HttpMethod.Delete,
            SessionPath(sessionId),
            body: null,
            timing.CommandTimeout,
            (response, _) =>
            {
                if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound)
                {
                    throw Unexpected(response);
                }
                return Task.FromResult(true);
            },
            cancellationToken);

    /// <summary>Hands the media server the browser's description of what it publishes.</summary>
    public Task<MediaSignalOutcome> SendOfferAsync(string sessionId, string sdp, CancellationToken cancellationToken) =>
        SignalAsync(sessionId, "offer", new { sdp }, cancellationToken);

    /// <summary>Answers the media server's offer number <paramref name="negotiationId"/>.</summary>
    public Task<MediaSignalOutcome> SendAnswerAsync(
        string sessionId,
        string sdp,
        long negotiationId,
        CancellationToken cancellationToken) =>
        SignalAsync(sessionId, "answer", new { sdp, negotiationId }, cancellationToken);

    /// <summary>Hands over one ICE candidate of the browser, or null for the end of its candidates.</summary>
    public Task<MediaSignalOutcome> SendCandidateAsync(
        string sessionId,
        JsonElement? candidate,
        CancellationToken cancellationToken) =>
        SignalAsync(sessionId, "candidate", new { candidate }, cancellationToken);

    /// <summary>
    /// Waits for the events after <paramref name="after"/> of the run
    /// <paramref name="epoch"/>. The media server answers at once when it has
    /// some, or when the run or the window of kept events no longer matches.
    /// </summary>
    public Task<MediaEventBatch> GetEventsAsync(string epoch, long after, CancellationToken cancellationToken)
    {
        var path = string.Create(
            CultureInfo.InvariantCulture,
            $"v1/events?epoch={Uri.EscapeDataString(epoch)}&after={after}&waitMs={timing.EventWaitMs}");
        return CallAsync(
            HttpMethod.Get,
            path,
            body: null,
            timing.CommandTimeout + TimeSpan.FromMilliseconds(timing.EventWaitMs),
            async (response, token) =>
            {
                Expect(response, HttpStatusCode.OK);
                var batch = await response.Content.ReadFromJsonAsync<MediaEventBatch>(Json, token);
                return batch is { Epoch.Length: > 0, Events: not null } &&
                    batch.Events.All(x => x is { Type: not null, SessionId: not null })
                        ? batch
                        : throw Malformed("v1/events");
            },
            cancellationToken);
    }

    private Task<MediaSignalOutcome> SignalAsync(
        string sessionId,
        string kind,
        object body,
        CancellationToken cancellationToken) =>
        CallAsync(
            HttpMethod.Post,
            $"{SessionPath(sessionId)}/{kind}",
            body,
            timing.CommandTimeout,
            (response, _) => Task.FromResult(response.StatusCode switch
            {
                _ when response.IsSuccessStatusCode => MediaSignalOutcome.Accepted,
                HttpStatusCode.NotFound => MediaSignalOutcome.UnknownSession,
                HttpStatusCode.Conflict => MediaSignalOutcome.Stale,
                // A body the media server will not read is as much the
                // browser's doing as a description it cannot use: the hub
                // limits the payload, not the body that JSON escaping makes
                // of it.
                HttpStatusCode.UnprocessableEntity or HttpStatusCode.RequestEntityTooLarge => MediaSignalOutcome.Refused,
                _ => throw Unexpected(response),
            }),
            cancellationToken);

    /// <summary>
    /// Sends one request under its own time limit. The limit covers reading
    /// the answer too, since a media server that stalls half way through a
    /// body is as unavailable as one that never answered.
    /// </summary>
    private async Task<T> CallAsync<T>(
        HttpMethod method,
        string path,
        object? body,
        TimeSpan timeout,
        Func<HttpResponseMessage, CancellationToken, Task<T>> read,
        CancellationToken cancellationToken)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(timeout);
        try
        {
            using var request = new HttpRequestMessage(method, path);
            if (body is not null)
            {
                request.Content = JsonContent.Create(body, options: Json);
            }

            // Without a secret the control API listens on loopback only and
            // checks nothing, so an empty bearer would only be noise.
            if (settings.ControlSecret.Length > 0)
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ControlSecret);
            }

            using var http = httpClients.CreateClient(HttpClientName);
            using var response = await http.SendAsync(request, limit.Token);
            return await read(response, limit.Token);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new MediaServerUnavailableException($"The media server did not answer {path} in time.", exception);
        }
        catch (HttpRequestException exception)
        {
            throw new MediaServerUnavailableException($"The media server could not be reached for {path}.", exception);
        }
        catch (JsonException exception)
        {
            throw new MediaServerUnavailableException($"The media server answered {path} with unreadable JSON.", exception);
        }
    }

    private static string SessionPath(string sessionId) => $"v1/sessions/{Uri.EscapeDataString(sessionId)}";

    private static void Expect(HttpResponseMessage response, HttpStatusCode status)
    {
        if (response.StatusCode != status)
        {
            throw Unexpected(response);
        }
    }

    private static MediaServerUnavailableException Unexpected(HttpResponseMessage response) =>
        new($"The media server answered {response.RequestMessage?.RequestUri?.AbsolutePath} with {(int)response.StatusCode}.");

    private static MediaServerUnavailableException Malformed(string path) =>
        new($"The media server answered {path} without the fields the contract names.");
}
