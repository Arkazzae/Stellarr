using System.Globalization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

/// <summary>
/// The media event pump: what the media server says reaches the
/// browser whose seat holds the session, in order, and a media server that
/// restarts, loses its events or goes away is handled as the contract says.
/// </summary>
public sealed partial class VoiceRoomTests
{
    [Fact]
    public async Task SignalsOfTheMediaServerReachTheirSessionInOrder()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);
        var majaSession = await maja.OpenMediaAsync(Salon);
        var adaSession = await ada.OpenMediaAsync(Salon);

        const int count = 60;
        for (var i = 1; i <= count; i++)
        {
            media.Signal(i % 2 == 0 ? majaSession : adaSession, "offer", MediaOffer(i));
        }
        const string tracks = """{"tracks":[{"mid":"4","userId":"30000000-0000-0000-0000-000000000002","kind":"audio","streamId":"mic"}]}""";
        media.Signal(majaSession, "tracks", tracks);

        foreach (var (peer, sessionId, first) in new[] { (maja, majaSession, 2), (ada, adaSession, 1) })
        {
            for (var i = first; i <= count; i += 2)
            {
                var signal = await peer["MediaSignal"].NextAsync();
                Assert.Equal(1, signal.GetProperty("protocolVersion").GetInt32());
                Assert.Equal(Salon, signal.GetProperty("channelId").GetString());
                Assert.Equal(sessionId, signal.GetProperty("sessionId").GetString());
                Assert.Equal("offer", signal.GetProperty("kind").GetString());
                Assert.Equal(MediaOffer(i), signal.GetProperty("payload").GetString());
            }
        }

        var directory = await maja["MediaSignal"].NextAsync();
        Assert.Equal("tracks", directory.GetProperty("kind").GetString());
        Assert.Equal(tracks, directory.GetProperty("payload").GetString());
        await ada.SettleAsync();
        Assert.Empty(ada["MediaSignal"].Drain());
    }

    [Fact]
    public async Task AnEventIssuedWhileTheSessionIsBeingCreatedStillReachesTheBrowser()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        media.SignalOnCreate = ("offer", MediaOffer(1));

        var sessionId = await maja.OpenMediaAsync(Salon);

        // The media server issued the offer and the pump fetched it before the
        // seat held the session; it is handed out once it does.
        var offer = await maja["MediaSignal"].NextAsync();
        Assert.Equal(sessionId, offer.GetProperty("sessionId").GetString());
        Assert.Equal(MediaOffer(1), offer.GetProperty("payload").GetString());
    }

    [Fact]
    public async Task AnEventForASessionNoSeatHoldsReachesNobody()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var earlier = await maja.OpenMediaAsync(Salon);
        var current = await maja.OpenMediaAsync(Salon);

        media.Signal(earlier, "offer", MediaOffer(1));
        media.Closed(earlier, "error");
        media.Signal("session-of-nobody", "offer", MediaOffer(2));
        media.Signal(current, "offer", MediaOffer(3));

        // Events of one session are handed out in order, so this one comes
        // after the pump went past everything before it.
        var only = await maja["MediaSignal"].NextAsync();
        Assert.Equal(current, only.GetProperty("sessionId").GetString());
        Assert.Equal(MediaOffer(3), only.GetProperty("payload").GetString());
        await maja.SettleAsync();
        Assert.Empty(maja["MediaSessionClosed"].Drain());
        Assert.Equal(current, app.Presence.MediaSessionOf(maja.Connection.ConnectionId!, TestData.VoiceChannelId)?.SessionId);
    }

    [Theory]
    [InlineData("transport-timeout")]
    [InlineData("error")]
    public async Task ASessionTheMediaPlaneClosedIsReportedWithItsReason(string reason)
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        var sessionId = await maja.OpenMediaAsync(Salon);

        media.Signal(sessionId, "answer", """{"type":"answer","sdp":"v=0 media"}""");
        media.Closed(sessionId, reason);

        Assert.Equal("answer", (await maja["MediaSignal"].NextAsync()).GetProperty("kind").GetString());
        var closed = await maja["MediaSessionClosed"].NextAsync();
        Assert.Equal(Salon, closed.GetProperty("channelId").GetString());
        Assert.Equal(sessionId, closed.GetProperty("sessionId").GetString());
        Assert.Equal(reason, closed.GetProperty("reason").GetString());
        Assert.True(app.Presence.IsConnectionInVoice(maja.Connection.ConnectionId!, TestData.VoiceChannelId));
        await RefusedAsync("Invalid media signal.", maja.MediaSignalAsync(Salon, sessionId, "offer", Offer));

        // The media server already let go of it; closing it again is not needed.
        Assert.Equal(0, media.Count("DELETE", $"/v1/sessions/{sessionId}"));
        var replacement = await maja.OpenMediaAsync(Salon);
        await maja.MediaSignalAsync(Salon, replacement, "offer", Offer);
    }

    [Fact]
    public async Task ARestartOfTheMediaServerEndsOnlySessionsOfEarlierEpochs()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);
        var before = await maja.OpenMediaAsync(Salon);

        // The pump is kept from noticing the restart until a session has
        // been opened in the new epoch.
        var polls = media.Count("GET", "/v1/events");
        media.HoldPolls();
        await media.CountAsync("GET", "/v1/events", polls + 1);
        media.Restart("epoch-2");
        var after = await ada.OpenMediaAsync(Salon);
        Assert.Equal("epoch-2", app.Presence.MediaSessionOf(ada.Connection.ConnectionId!, TestData.VoiceChannelId)?.Epoch);
        media.ReleasePolls();

        var closed = await maja["MediaSessionClosed"].NextAsync();
        Assert.Equal(before, closed.GetProperty("sessionId").GetString());
        Assert.Equal("media-restarted", closed.GetProperty("reason").GetString());
        Assert.Null(app.Presence.MediaSessionOf(maja.Connection.ConnectionId!, TestData.VoiceChannelId));

        // The session of the new epoch lives on, and the pump follows that epoch from its start.
        media.Signal(after, "offer", MediaOffer(1));
        Assert.Equal(MediaOffer(1), (await ada["MediaSignal"].NextAsync()).GetProperty("payload").GetString());
        Assert.Contains(media.Requests, x => x.Path == "/v1/events" && x.Query.Contains("epoch=epoch-2&after=0", StringComparison.Ordinal));
        await ada.SettleAsync();
        Assert.Empty(ada["MediaSessionClosed"].Drain());
        await ada.MediaSignalAsync(Salon, after, "offer", Offer);
        Assert.Equal(1, media.Count("POST", "/v1/reset"));
    }

    [Fact]
    public async Task LosingTheWindowOfEventsResetsTheMediaServerAndEndsEverySession()
    {
        var media = new FakeMediaServer();
        await using var app = new VoiceApp(media);
        await app.MediaReadyAsync();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);
        var majaSession = await maja.OpenMediaAsync(Salon);
        var adaSession = await ada.OpenMediaAsync(Salon);
        media.Signal(majaSession, "offer", MediaOffer(1));
        await maja["MediaSignal"].NextAsync();

        media.LoseWindow();

        foreach (var (peer, sessionId) in new[] { (maja, majaSession), (ada, adaSession) })
        {
            var closed = await peer["MediaSessionClosed"].NextAsync();
            Assert.Equal(sessionId, closed.GetProperty("sessionId").GetString());
            Assert.Equal("media-restarted", closed.GetProperty("reason").GetString());
        }
        Assert.Equal(2, media.Count("POST", "/v1/reset"));

        // After the reset the pump follows on from where the media server is.
        await app.MediaReadyAsync();
        var reopened = await maja.OpenMediaAsync(Salon);
        media.Signal(reopened, "offer", MediaOffer(2));
        Assert.Equal(MediaOffer(2), (await maja["MediaSignal"].NextAsync()).GetProperty("payload").GetString());
    }

    [Fact]
    public async Task TheEventPumpWaitsForAMediaServerThatIsDownAndCarriesOnWhenItIsBack()
    {
        var media = new FakeMediaServer { Down = true };
        await using var app = new VoiceApp(media);
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);

        // Down at start: the reset is tried again and again, and no session opens meanwhile.
        await media.CountAsync("POST", "/v1/reset", 3);
        await RefusedAsync("Media server is unavailable.", maja.OpenMediaAsync(Salon));
        media.Down = false;
        await app.MediaReadyAsync();
        var resets = media.Count("POST", "/v1/reset");
        var sessionId = await maja.OpenMediaAsync(Salon);

        // Down for a while in the same run: nothing is lost and the session stays.
        media.Down = true;
        var polls = media.Count("GET", "/v1/events");
        await media.CountAsync("GET", "/v1/events", polls + 3);
        media.Signal(sessionId, "offer", MediaOffer(1));
        media.Down = false;
        Assert.Equal(MediaOffer(1), (await maja["MediaSignal"].NextAsync()).GetProperty("payload").GetString());
        await maja.MediaSignalAsync(Salon, sessionId, "answer", Answer);
        await maja.SettleAsync();
        Assert.Empty(maja["MediaSessionClosed"].Drain());

        // Down and restarted meanwhile: the first answer after the outage tells.
        media.Down = true;
        polls = media.Count("GET", "/v1/events");
        await media.CountAsync("GET", "/v1/events", polls + 2);
        media.Restart("epoch-2");
        media.Down = false;
        var closed = await maja["MediaSessionClosed"].NextAsync();
        Assert.Equal(sessionId, closed.GetProperty("sessionId").GetString());
        Assert.Equal("media-restarted", closed.GetProperty("reason").GetString());
        // A new epoch needs no reset of its own: the new run has no sessions.
        Assert.Equal(resets, media.Count("POST", "/v1/reset"));
        await maja.OpenMediaAsync(Salon);
    }

    /// <summary>A media-server offer numbered <paramref name="negotiationId"/>, as an event payload.</summary>
    private static string MediaOffer(int negotiationId) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $$"""{"type":"offer","sdp":"v=0 media {{negotiationId}}","negotiationId":{{negotiationId}},"tracks":[]}""");
}
