using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

/// <summary>
/// The control API of Stellarr Media as the contract describes it, played in
/// memory behind the API's HTTP client. It keeps sessions and a numbered list
/// of events, answers the long poll, and lets a test restart it, take it
/// down, make it lose its window of events or refuse signals.
/// </summary>
internal sealed class FakeMediaServer : HttpMessageHandler
{
    internal const string Secret = "media-test-secret";

    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private readonly Lock _gate = new();
    private readonly List<FakeMediaRequest> _requests = [];
    private readonly Dictionary<string, (Guid RoomId, Guid UserId)> _sessions = new(StringComparer.Ordinal);
    private readonly List<string> _events = [];
    private readonly Dictionary<string, HttpStatusCode> _signalAnswers = new(StringComparer.Ordinal);
    private TaskCompletionSource _published = NewSignal();
    private TaskCompletionSource? _pollsHeld;
    private string _epoch = "epoch-1";
    private long _firstKeptSeq = 1;
    private int _sessionCount;

    private TaskCompletionSource? _createsHeld;
    private long _lastServedSeq;

    /// <summary>When set, every request fails as a refused connection would.</summary>
    internal bool Down { get; set; }

    /// <summary>How long every request but the event poll takes before it is answered.</summary>
    internal TimeSpan Slowness { get; set; }

    /// <summary>The API's limit for one command, which <see cref="Install"/> sets.</summary>
    internal TimeSpan CommandTimeout { get; init; } = TimeSpan.FromSeconds(3);

    /// <summary>
    /// How long the API's event poll waits for an event, which <see cref="Install"/>
    /// sets. Short, so a test sees a change of state at once; a host that only
    /// needs a media server to be there can wait as long as the API does.
    /// </summary>
    internal int EventWaitMs { get; init; } = 250;

    /// <summary>
    /// When set, creating a session issues this signal for the new session at
    /// once and answers only after a poll has handed the signal out, as a
    /// media server that offers its forwarded tracks straight away can.
    /// </summary>
    internal (string Kind, string Payload)? SignalOnCreate { get; set; }

    internal string Epoch
    {
        get
        {
            lock (_gate)
            {
                return _epoch;
            }
        }
    }

    internal IReadOnlyList<FakeMediaRequest> Requests
    {
        get
        {
            lock (_gate)
            {
                return [.. _requests];
            }
        }
    }

    internal IReadOnlyCollection<string> Sessions
    {
        get
        {
            lock (_gate)
            {
                return [.. _sessions.Keys];
            }
        }
    }

    /// <summary>
    /// Wires this fake in as the application's media server, with short pauses.
    /// Installed after another fake, it replaces that one.
    /// </summary>
    internal void Install(IServiceCollection services)
    {
        services.AddHttpClient(MediaControlClient.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => this);
        services.AddSingleton(new MediaControlTiming
        {
            CommandTimeout = CommandTimeout,
            EventWaitMs = EventWaitMs,
            RetryPause = TimeSpan.FromMilliseconds(100),
        });
    }

    /// <summary>A new run of the process: a new epoch, no sessions, and numbering from the start.</summary>
    internal void Restart(string epoch)
    {
        lock (_gate)
        {
            _epoch = epoch;
            _sessions.Clear();
            _events.Clear();
            _firstKeptSeq = 1;
            Wake();
        }
    }

    /// <summary>Forgets a session, as a media server that lost it would.</summary>
    internal void DropSession(string sessionId)
    {
        lock (_gate)
        {
            _sessions.Remove(sessionId);
        }
    }

    /// <summary>
    /// Behaves as if more events than the window holds were issued since the
    /// last poll: the next poll gets a reset in the same epoch, until the API
    /// resets the media server.
    /// </summary>
    internal void LoseWindow()
    {
        lock (_gate)
        {
            _firstKeptSeq = _events.Count + 2;
            Wake();
        }
    }

    /// <summary>Answers signals of one session with this status instead of the usual 204.</summary>
    internal void AnswerSignals(string sessionId, HttpStatusCode status)
    {
        lock (_gate)
        {
            _signalAnswers[sessionId] = status;
        }
    }

    /// <summary>Keeps every long poll waiting until <see cref="ReleasePolls"/>.</summary>
    internal void HoldPolls()
    {
        lock (_gate)
        {
            _pollsHeld ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        }
    }

    internal void ReleasePolls()
    {
        lock (_gate)
        {
            _pollsHeld?.TrySetResult();
            _pollsHeld = null;
        }
    }

    /// <summary>Keeps every request to create a session waiting, before it creates anything, until <see cref="ReleaseCreates"/>.</summary>
    internal void HoldCreates()
    {
        lock (_gate)
        {
            _createsHeld ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        }
    }

    internal void ReleaseCreates()
    {
        lock (_gate)
        {
            _createsHeld?.TrySetResult();
            _createsHeld = null;
        }
    }

    internal long Signal(string sessionId, string kind, string payloadJson) =>
        Publish(seq => $$"""{"seq":{{seq}},"type":"signal","sessionId":"{{sessionId}}","kind":"{{kind}}","payload":{{payloadJson}}}""");

    internal long Closed(string sessionId, string reason) =>
        Publish(seq => $$"""{"seq":{{seq}},"type":"closed","sessionId":"{{sessionId}}","reason":"{{reason}}"}""");

    /// <summary>The first request that <paramref name="match"/> takes, waiting for it to arrive.</summary>
    internal async Task<FakeMediaRequest> NextRequestAsync(Func<FakeMediaRequest, bool> match)
    {
        using var timeout = new CancellationTokenSource(Patience);
        while (true)
        {
            if (Requests.FirstOrDefault(match) is { } found)
            {
                return found;
            }
            await Task.Delay(10, timeout.Token);
        }
    }

    /// <summary>Waits until <paramref name="condition"/> holds.</summary>
    internal static async Task UntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(Patience);
        while (!condition())
        {
            await Task.Delay(10, timeout.Token);
        }
    }

    /// <summary>Waits until <paramref name="count"/> requests of this kind have arrived.</summary>
    internal Task CountAsync(string method, string path, int count) => UntilAsync(() => Count(method, path) >= count);

    internal Task<FakeMediaRequest> DeleteOfAsync(string sessionId) =>
        NextRequestAsync(x => x.Method == "DELETE" && x.Path == $"/v1/sessions/{sessionId}");

    internal int Count(string method, string path) =>
        Requests.Count(x => x.Method == method && x.Path == path);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        var recorded = new FakeMediaRequest(
            request.Method.Method,
            request.RequestUri!.AbsolutePath,
            request.RequestUri.Query,
            body,
            request.Headers.Authorization?.ToString());
        lock (_gate)
        {
            _requests.Add(recorded);
        }

        if (Down)
        {
            throw new HttpRequestException("Connection refused (fake media server is down).");
        }

        if (recorded.Authorization != $"Bearer {Secret}")
        {
            return Error(HttpStatusCode.Unauthorized, "unauthorized");
        }

        var segments = recorded.Path.Trim('/').Split('/');
        if (Slowness > TimeSpan.Zero && segments is not ["v1", "events"])
        {
            await Task.Delay(Slowness, cancellationToken);
        }

        return (recorded.Method, segments) switch
        {
            ("POST", ["v1", "reset"]) => Reset(),
            ("POST", ["v1", "sessions"]) => await CreateSessionAsync(body, cancellationToken),
            ("DELETE", ["v1", "sessions", var id]) => CloseSession(id),
            ("POST", ["v1", "sessions", var id, "offer" or "answer" or "candidate"]) => TakeSignal(id),
            ("GET", ["v1", "events"]) => await PollAsync(recorded.Query, cancellationToken),
            _ => Error(HttpStatusCode.NotFound, "not-found"),
        };
    }

    private HttpResponseMessage Reset()
    {
        lock (_gate)
        {
            _sessions.Clear();
            _firstKeptSeq = Math.Min(_firstKeptSeq, _events.Count + 1);
            return Json(HttpStatusCode.OK, new { epoch = _epoch, seq = _events.Count });
        }
    }

    private async Task<HttpResponseMessage> CreateSessionAsync(string body, CancellationToken cancellationToken)
    {
        using var request = JsonDocument.Parse(body);
        var roomId = request.RootElement.GetProperty("roomId").GetGuid();
        var userId = request.RootElement.GetProperty("userId").GetGuid();
        Task? held;
        lock (_gate)
        {
            held = _createsHeld?.Task;
        }
        if (held is not null)
        {
            await held.WaitAsync(cancellationToken);
        }

        string sessionId;
        string epoch;
        lock (_gate)
        {
            // One session per account, as the media server keeps it.
            foreach (var older in _sessions.Where(x => x.Value.UserId == userId).Select(x => x.Key).ToArray())
            {
                _sessions.Remove(older);
            }

            sessionId = $"session-{++_sessionCount}";
            epoch = _epoch;
            _sessions[sessionId] = (roomId, userId);
        }

        if (SignalOnCreate is { } signal)
        {
            var seq = Signal(sessionId, signal.Kind, signal.Payload);
            await UntilAsync(() => Interlocked.Read(ref _lastServedSeq) >= seq).WaitAsync(cancellationToken);
            // Long enough for a pump that did not wait to have handed the
            // event out already, to nobody.
            await Task.Delay(TimeSpan.FromMilliseconds(150), cancellationToken);
        }

        return Json(HttpStatusCode.Created, new { sessionId, epoch });
    }

    private HttpResponseMessage CloseSession(string sessionId)
    {
        lock (_gate)
        {
            _sessions.Remove(sessionId);
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        }
    }

    private HttpResponseMessage TakeSignal(string sessionId)
    {
        lock (_gate)
        {
            if (_signalAnswers.TryGetValue(sessionId, out var status))
            {
                return status == HttpStatusCode.NoContent
                    ? new HttpResponseMessage(status)
                    : Error(status, status switch
                    {
                        HttpStatusCode.Conflict => "stale-negotiation",
                        HttpStatusCode.UnprocessableEntity => "invalid-sdp",
                        HttpStatusCode.RequestEntityTooLarge => "payload-too-large",
                        _ => "failure",
                    });
            }

            return _sessions.ContainsKey(sessionId)
                ? new HttpResponseMessage(HttpStatusCode.NoContent)
                : Error(HttpStatusCode.NotFound, "unknown-session");
        }
    }

    private async Task<HttpResponseMessage> PollAsync(string query, CancellationToken cancellationToken)
    {
        var parameters = query.TrimStart('?').Split('&')
            .Select(x => x.Split('=', 2))
            .ToDictionary(x => x[0], x => Uri.UnescapeDataString(x[1]), StringComparer.Ordinal);
        var epoch = parameters["epoch"];
        var after = long.Parse(parameters["after"], CultureInfo.InvariantCulture);
        var waitMs = int.Parse(parameters["waitMs"], CultureInfo.InvariantCulture);

        Task? held;
        lock (_gate)
        {
            held = _pollsHeld?.Task;
        }
        if (held is not null)
        {
            await held.WaitAsync(cancellationToken);
        }

        using var wait = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        wait.CancelAfter(waitMs);
        while (true)
        {
            Task published;
            lock (_gate)
            {
                if (epoch != _epoch || after + 1 < _firstKeptSeq)
                {
                    return Json(HttpStatusCode.OK, new { epoch = _epoch, reset = true, events = Array.Empty<object>() });
                }

                var pending = _events.Skip((int)after).Take(256).ToArray();
                if (pending.Length > 0 || wait.IsCancellationRequested)
                {
                    Interlocked.Exchange(ref _lastServedSeq, Math.Max(_lastServedSeq, after + pending.Length));
                    return Raw(HttpStatusCode.OK, $$"""{"epoch":"{{_epoch}}","reset":false,"events":[{{string.Join(",", pending)}}]}""");
                }
                published = _published.Task;
            }

            try
            {
                await published.WaitAsync(wait.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                // The wait is over; the loop answers with what there is.
            }
        }
    }

    private long Publish(Func<long, string> render)
    {
        lock (_gate)
        {
            var seq = _events.Count + 1L;
            _events.Add(render(seq));
            Wake();
            return seq;
        }
    }

    private void Wake()
    {
        _published.TrySetResult();
        _published = NewSignal();
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static HttpResponseMessage Error(HttpStatusCode status, string code) =>
        Json(status, new { error = code, detail = code });

    private static HttpResponseMessage Json(HttpStatusCode status, object body) =>
        Raw(status, JsonSerializer.Serialize(body));

    private static HttpResponseMessage Raw(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

/// <summary>One request the API sent the media server.</summary>
internal sealed record FakeMediaRequest(string Method, string Path, string Query, string Body, string? Authorization)
{
    public JsonElement Json => JsonDocument.Parse(Body).RootElement.Clone();
}
