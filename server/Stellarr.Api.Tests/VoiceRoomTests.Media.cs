using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

/// <summary>
/// The hub leg of the sfu topology: opening a media session for a seat,
/// signalling the media server through the hub, and the rule that a session
/// lives exactly as long as its seat. The media server is a fake behind the
/// API's HTTP client.
/// </summary>
public sealed partial class VoiceRoomTests
{
    private const string Offer = """{"type":"offer","sdp":"v=0 browser"}""";
    private const string Answer = """{"type":"answer","sdp":"v=0 answer","negotiationId":7}""";
    private const string Candidate =
        """{"candidate":"candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host","sdpMid":"0","sdpMLineIndex":0}""";

    [Fact]
    public async Task TheMeshTopologyRefusesMediaSessionsAndNeverCallsTheMediaServer()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media, MediaTopology.Mesh);
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);

        await RefusedAsync("Media server is not enabled.", maja.OpenMediaAsync(Salon));
        await RefusedAsync("Media server is not enabled.", maja.MediaSignalAsync(Salon, "session-1", "offer", Offer));

        // Browser to browser signalling is what it was.
        await maja.SignalAsync(Salon, "offer", Offer, toUserId: ada.Id.ToString());
        Assert.Equal("offer", (await ada["VoiceSignal"].NextAsync()).GetProperty("kind").GetString());
        await maja.LeaveAsync();
        await ada.Connection.StopAsync();

        // Longer than the pump's pause and poll would take, had it started.
        await Task.Delay(TimeSpan.FromMilliseconds(500));
        Assert.Empty(media.Requests);
    }

    [Fact]
    public async Task ASessionNeedsTheCallersSeatInThatRoom()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        app.Seed(db => db.DirectConversations.Add(Conversation("maja", "ada")));
        var maja = await app.ConnectAsync("maja");

        await RefusedAsync("Not seated in this voice room.", maja.OpenMediaAsync(Salon));
        await RefusedAsync("Not seated in this voice room.", maja.OpenMediaAsync(MajaAndAda.ToString()));
        await RefusedAsync("Invalid channelId.", maja.OpenMediaAsync("not-a-guid"));
        await maja.JoinAsync(Salon);
        await RefusedAsync("Not seated in this voice room.", maja.OpenMediaAsync(NightShift));
        Assert.Equal(0, media.Count("POST", "/v1/sessions"));

        var sessionId = await maja.OpenMediaAsync(Salon);

        var created = Assert.Single(media.Requests, x => x.Method == "POST" && x.Path == "/v1/sessions");
        Assert.Equal(Salon, created.Json.GetProperty("roomId").GetString());
        Assert.Equal(maja.Id.ToString(), created.Json.GetProperty("userId").GetString());
        Assert.Equal($"Bearer {FakeMediaServer.Secret}", created.Authorization);
        Assert.Equal(sessionId, app.Presence.MediaSessionOf(maja.Connection.ConnectionId!, TestData.VoiceChannelId)?.SessionId);
        Assert.Equal(media.Epoch, app.Presence.MediaSessionOf(maja.Connection.ConnectionId!, TestData.VoiceChannelId)?.Epoch);
    }

    [Fact]
    public async Task OpeningAgainClosesTheEarlierSessionSilently()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);

        var first = await maja.OpenMediaAsync(Salon);
        var second = await maja.OpenMediaAsync(Salon);

        Assert.NotEqual(first, second);
        await media.DeleteOfAsync(first);
        await RefusedAsync("Invalid media signal.", maja.MediaSignalAsync(Salon, first, "offer", Offer));
        await maja.MediaSignalAsync(Salon, second, "offer", Offer);
        Assert.Equal(1, media.Count("POST", $"/v1/sessions/{second}/offer"));
        Assert.Empty(maja["MediaSessionClosed"].Drain());
    }

    [Fact]
    public async Task AMediaServerThatIsDownRefusesTheSessionButNeverTheSeat()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var observer = await app.ConnectAsync("jo");
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);

        media.Down = true;

        await RefusedAsync("Media server is unavailable.", maja.MediaSignalAsync(Salon, sessionId, "offer", Offer));
        await RefusedAsync("Media server is unavailable.", maja.OpenMediaAsync(Salon));
        // Voice itself, presence and the occupancy others see carry on.
        await maja.SignalAsync(Salon, "state", """{"muted":true}""");
        await observer["VoiceParticipantChanged"].NextAsync(x => InRoom(Salon)(x) && IsMuted(x, maja.Id));
        await maja.LeaveAsync();
        await observer["VoiceParticipantChanged"].NextAsync(x => InRoom(Salon)(x) && Occupants(x).Length == 0);
        Assert.Empty(app.Presence.VoiceUsers(TestData.VoiceChannelId));
        await maja.JoinAsync(Salon);

        // The close the seat asked for waits for the media server and arrives.
        media.Down = false;
        await FakeMediaServer.UntilAsync(() => !media.Sessions.Contains(sessionId));
        Assert.NotEqual(sessionId, await maja.OpenMediaAsync(Salon));
    }

    [Fact]
    public async Task ASlowMediaServerHoldsUpOnlyTheMediaCallsAndOnlyForTheirLimit()
    {
        var media = new FakeMediaServer { CommandTimeout = TimeSpan.FromMilliseconds(500) };
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);
        using var chat = await app.HttpAsync("ada");

        media.Slowness = TimeSpan.FromSeconds(5);
        var clock = System.Diagnostics.Stopwatch.StartNew();

        await RefusedAsync("Media server is unavailable.", maja.MediaSignalAsync(Salon, sessionId, "offer", Offer));
        await RefusedAsync("Media server is unavailable.", maja.OpenMediaAsync(Salon));
        // Text chat, presence and voice seats do not wait for the media server.
        (await chat.PostAsJsonAsync($"/api/channels/{TestData.GeneralChannelId}/messages", new { content = "still here" }))
            .EnsureSuccessStatusCode();
        await ada.Connection.InvokeAsync("SetPresence", "dnd");
        await ada.JoinAsync(Salon);
        await ada.LeaveAsync();
        await maja.LeaveAsync();
        Assert.Empty(app.Presence.VoiceUsers(TestData.VoiceChannelId));

        // Two commands that gave up after their limit, and nothing that waited
        // for the media server's five seconds.
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(4), $"took {clock.Elapsed}");
        media.Slowness = TimeSpan.Zero;
        await maja.JoinAsync(Salon);
        await maja.OpenMediaAsync(Salon);
    }

    [Fact]
    public async Task ASeatThatEndsWhileItsSessionIsBeingCreatedGetsNone()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var jo = await app.ConnectAsync("jo");
        await jo.JoinAsync(Salon);
        using var owner = await app.HttpAsync("maja");
        media.HoldCreates();

        var opening = jo.OpenMediaAsync(Salon);
        await media.CountAsync("POST", "/v1/sessions", 1);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.DeleteAsync($"/api/admin/channels/{Salon}/members/{jo.Id}")).StatusCode);
        media.ReleaseCreates();

        await RefusedAsync("Not seated in this voice room.", opening);
        // The session the media server made for the seat that is gone is closed again.
        var created = Assert.Single(
            media.Requests,
            x => x.Method == "POST" && x.Path == "/v1/sessions");
        await media.NextRequestAsync(x => x.Method == "DELETE");
        await FakeMediaServer.UntilAsync(() => media.Sessions.Count == 0);
        Assert.Equal(jo.Id.ToString(), created.Json.GetProperty("userId").GetString());
    }

    [Fact]
    public async Task EveryCheckOfTheEnvelopeRefusesTheSignalBeforeTheMediaServerSeesIt()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        var majaElsewhere = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);
        var own = await maja.OpenMediaAsync(Salon);
        var others = await ada.OpenMediaAsync(Salon);

        const string refused = "Invalid media signal.";
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, "offer", Offer, version: 2));
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, "offer", Offer, version: 0));
        foreach (var kind in new[] { "state", "tracks", "hello", "OFFER" })
        {
            await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, kind, "{}"));
        }
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, null, Offer));
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, "offer", null));
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, "offer", OfferOfLength(RtcProtocol.MaxSignalBytes + 1)));
        await RefusedAsync(refused, maja.MediaSignalAsync(NightShift, own, "offer", Offer));
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, others, "offer", Offer));
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, null, "offer", Offer));
        await RefusedAsync(refused, maja.MediaSignalAsync(Salon, "session-unknown", "offer", Offer));
        await RefusedAsync(refused, majaElsewhere.MediaSignalAsync(Salon, own, "offer", Offer));
        await RefusedAsync("Invalid ChannelId.", maja.MediaSignalAsync("not-a-guid", own, "offer", Offer));
        await RefusedAsync(refused, maja.Connection.InvokeAsync("SendMediaSignal", (object?)null));

        // A payload has to be what its kind promises.
        foreach (var (kind, payload) in new[]
        {
            ("offer", "{not json"),
            ("offer", "null"),
            ("offer", """{"type":"answer","sdp":"x"}"""),
            ("offer", """{"type":"offer"}"""),
            ("offer", """{"type":"offer","sdp":7}"""),
            ("answer", """{"type":"answer","sdp":"x"}"""),
            ("answer", """{"type":"answer","sdp":"x","negotiationId":"7"}"""),
            ("answer", """{"type":"answer","sdp":"x","negotiationId":1.5}"""),
            ("answer", """{"type":"offer","sdp":"x","negotiationId":7}"""),
            ("candidate", "\"candidate:1\""),
            ("candidate", "[]"),
        })
        {
            await RefusedAsync(refused, maja.MediaSignalAsync(Salon, own, kind, payload));
        }

        Assert.DoesNotContain(media.Requests, x => x.Path.StartsWith("/v1/sessions/", StringComparison.Ordinal));

        // The refusals left the session as it was, and the limit itself passes.
        await maja.MediaSignalAsync(Salon, own, "offer", OfferOfLength(RtcProtocol.MaxSignalBytes));
        Assert.Equal(1, media.Count("POST", $"/v1/sessions/{own}/offer"));
    }

    [Fact]
    public async Task SignalsReachTheMediaServerInTheFormOfItsControlApiAndInOrder()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);

        await maja.MediaSignalAsync(Salon, sessionId, "offer", Offer);
        await maja.MediaSignalAsync(Salon, sessionId, "candidate", Candidate);
        await maja.MediaSignalAsync(Salon, sessionId, "candidate", "null");
        await maja.MediaSignalAsync(Salon, sessionId, "answer", Answer);

        var signals = media.Requests.Where(x => x.Path.StartsWith($"/v1/sessions/{sessionId}/", StringComparison.Ordinal)).ToArray();
        Assert.Equal(
            ["offer", "candidate", "candidate", "answer"],
            signals.Select(x => x.Path.Split('/').Last()));
        Assert.All(signals, x => Assert.Equal("POST", x.Method));
        Assert.All(signals, x => Assert.Equal($"Bearer {FakeMediaServer.Secret}", x.Authorization));
        Assert.Equal("""{"sdp":"v=0 browser"}""", signals[0].Body);
        Assert.Equal($$"""{"candidate":{{Candidate}}}""", signals[1].Body);
        Assert.Equal("""{"candidate":null}""", signals[2].Body);
        Assert.Equal("""{"sdp":"v=0 answer","negotiationId":7}""", signals[3].Body);
    }

    [Fact]
    public async Task TheSfuTopologyRefusesSignalsThatWouldConnectBrowsersDirectly()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);

        foreach (var (kind, payload) in new[] { ("offer", Offer), ("answer", Answer), ("candidate", Candidate) })
        {
            await RefusedAsync("Invalid voice signal.", maja.SignalAsync(Salon, kind, payload));
            await RefusedAsync("Invalid voice signal.", maja.SignalAsync(Salon, kind, payload, toUserId: ada.Id.ToString()));
        }
        await AssertNoSignalAsync(ada);

        const string state = """{"muted":false,"screenStreamId":"screen-1","cameraStreamId":null}""";
        await maja.SignalAsync(Salon, "state", state);
        Assert.Equal(state, (await ada["VoiceSignal"].NextAsync()).GetProperty("payload").GetString());
    }

    [Fact]
    public async Task AStaleAnswerPassesQuietlyWhileARefusedOrFailedSignalIsReported()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);

        media.AnswerSignals(sessionId, HttpStatusCode.Conflict);
        await maja.MediaSignalAsync(Salon, sessionId, "answer", Answer);
        media.AnswerSignals(sessionId, HttpStatusCode.UnprocessableEntity);
        await RefusedAsync("Invalid media signal.", maja.MediaSignalAsync(Salon, sessionId, "offer", Offer));
        media.AnswerSignals(sessionId, HttpStatusCode.RequestEntityTooLarge);
        await RefusedAsync("Invalid media signal.", maja.MediaSignalAsync(Salon, sessionId, "offer", Offer));
        media.AnswerSignals(sessionId, HttpStatusCode.InternalServerError);
        await RefusedAsync("Media server is unavailable.", maja.MediaSignalAsync(Salon, sessionId, "offer", Offer));

        // None of these ends the session.
        Assert.Equal(sessionId, app.Presence.MediaSessionOf(maja.Connection.ConnectionId!, TestData.VoiceChannelId)?.SessionId);
        await maja.SettleAsync();
        Assert.Empty(maja["MediaSessionClosed"].Drain());
    }

    [Fact]
    public async Task ASessionTheMediaServerLostIsForgottenAndTheBrowserToldToReplaceIt()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);
        media.DropSession(sessionId);

        await maja.MediaSignalAsync(Salon, sessionId, "candidate", Candidate);

        var closed = await maja["MediaSessionClosed"].NextAsync();
        Assert.Equal(Salon, closed.GetProperty("channelId").GetString());
        Assert.Equal(sessionId, closed.GetProperty("sessionId").GetString());
        Assert.Equal("media-restarted", closed.GetProperty("reason").GetString());
        Assert.True(app.Presence.IsConnectionInVoice(maja.Connection.ConnectionId!, TestData.VoiceChannelId));
        Assert.Null(app.Presence.MediaSessionOf(maja.Connection.ConnectionId!, TestData.VoiceChannelId));
        await RefusedAsync("Invalid media signal.", maja.MediaSignalAsync(Salon, sessionId, "candidate", Candidate));

        var replacement = await maja.OpenMediaAsync(Salon);
        await maja.MediaSignalAsync(Salon, replacement, "offer", Offer);
        await maja.SettleAsync();
        Assert.Empty(maja["MediaSessionClosed"].Drain());
    }

    [Theory]
    [InlineData("leave")]
    [InlineData("disconnect")]
    [InlineData("newer tab")]
    [InlineData("another room")]
    [InlineData("voice kick")]
    [InlineData("move")]
    [InlineData("server kick")]
    [InlineData("ban")]
    public async Task EveryChangeOfTheSeatClosesItsMediaSessionWithoutAnEvent(string change)
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var jo = await app.ConnectAsync("jo");
        await jo.JoinAsync(Salon);
        var sessionId = await jo.OpenMediaAsync(Salon);
        using var owner = await app.HttpAsync("maja");

        switch (change)
        {
            case "leave":
                await jo.LeaveAsync();
                break;
            case "disconnect":
                await jo.Connection.StopAsync();
                break;
            case "newer tab":
                await (await app.ConnectAsync("jo")).JoinAsync(Salon);
                await jo["VoiceSessionReplaced"].NextAsync();
                break;
            case "another room":
                await jo.JoinAsync(NightShift);
                break;
            case "voice kick":
                Assert.Equal(
                    HttpStatusCode.NoContent,
                    (await owner.DeleteAsync($"/api/admin/channels/{Salon}/members/{jo.Id}")).StatusCode);
                await jo["VoiceChannelKicked"].NextAsync();
                break;
            case "move":
                Assert.Equal(
                    HttpStatusCode.NoContent,
                    (await owner.PatchAsJsonAsync(
                        $"/api/admin/channels/{Salon}/members/{jo.Id}",
                        new { targetChannelId = NightShift })).StatusCode);
                await jo["VoiceChannelMoved"].NextAsync();
                break;
            case "server kick":
                Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/members/{jo.Id}")).StatusCode);
                break;
            case "ban":
                Assert.Equal(
                    HttpStatusCode.Created,
                    (await owner.PostAsJsonAsync($"/api/admin/members/{jo.Id}/ban", new { reason = (string?)null })).StatusCode);
                break;
        }

        var closed = await media.DeleteOfAsync(sessionId);
        Assert.Equal($"Bearer {FakeMediaServer.Secret}", closed.Authorization);
        Assert.DoesNotContain(sessionId, media.Sessions);
        if (change != "disconnect")
        {
            await jo.SettleAsync();
            Assert.Empty(jo["MediaSessionClosed"].Drain());
            await RefusedAsync("Invalid media signal.", jo.MediaSignalAsync(Salon, sessionId, "offer", Offer));
        }

        if (change == "move")
        {
            // The client opens a session in the room it was moved to.
            var moved = await jo.OpenMediaAsync(NightShift);
            await jo.MediaSignalAsync(NightShift, moved, "offer", Offer);
        }
    }

    [Theory]
    [InlineData("decline")]
    [InlineData("block")]
    public async Task EndingADirectCallClosesTheMediaSessionsOfBothPeople(string ending)
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        app.Seed(db => db.DirectConversations.Add(Conversation("maja", "ada")));
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var room = MajaAndAda.ToString();
        await maja.JoinAsync(room);
        await ada.JoinAsync(room);
        var majaSession = await maja.OpenMediaAsync(room);
        var adaSession = await ada.OpenMediaAsync(room);

        if (ending == "decline")
        {
            await ada.Connection.InvokeAsync("DeclineDirectCall", room);
        }
        else
        {
            using var blocker = await app.HttpAsync("ada");
            (await blocker.PostAsync($"/api/social/blocks/{maja.Id}", null)).EnsureSuccessStatusCode();
        }

        await media.DeleteOfAsync(majaSession);
        await media.DeleteOfAsync(adaSession);
        foreach (var peer in new[] { maja, ada })
        {
            await peer["DirectCallDeclined"].NextAsync();
            await peer.SettleAsync();
            Assert.Empty(peer["MediaSessionClosed"].Drain());
        }
    }

    [Fact]
    public async Task JoiningTheRoomTheConnectionSitsInKeepsItsSession()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);

        await maja.JoinAsync(Salon);

        await maja.MediaSignalAsync(Salon, sessionId, "offer", Offer);
        Assert.Equal(0, media.Count("DELETE", $"/v1/sessions/{sessionId}"));
    }

    /// <summary>An offer whose payload is exactly <paramref name="bytes"/> long.</summary>
    private static string OfferOfLength(int bytes)
    {
        const string head = "{\"type\":\"offer\",\"sdp\":\"";
        const string tail = "\"}";
        return head + new string('x', bytes - head.Length - tail.Length) + tail;
    }
}
