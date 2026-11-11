using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

/// <summary>
/// Joining, leaving and signalling in voice rooms. Every test runs against an
/// application of its own: seats live in a singleton, and a connection that is
/// dropped by one test would otherwise free its seat in the middle of the next.
/// </summary>
public sealed partial class VoiceRoomTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private static readonly string Salon = TestData.VoiceChannelId.ToString();
    private static readonly string NightShift = TestData.NightShiftChannelId.ToString();

    private static readonly Dictionary<string, (Guid Id, string Password)> Accounts = new()
    {
        ["maja"] = (Guid.Parse("30000000-0000-0000-0000-000000000001"), "Aurora!2026"),
        ["ada"] = (Guid.Parse("30000000-0000-0000-0000-000000000002"), "Quasar!2026"),
        ["ilya"] = (Guid.Parse("30000000-0000-0000-0000-000000000003"), "Meteor!2026"),
        ["nils"] = (Guid.Parse("30000000-0000-0000-0000-000000000004"), "Zenith!2026"),
        ["jo"] = (Guid.Parse("30000000-0000-0000-0000-000000000005"), "Corona!2026"),
    };

    [Fact]
    public async Task JoiningTellsTheServerWhoIsInTheCallButNobodyElse()
    {
        await using var app = new VoiceApp();
        var (otherServerId, _) = await app.AddServerAsync(Accounts["nils"].Id);
        var observer = await app.ConnectAsync("jo");
        var elsewhere = await app.ConnectAsync("nils", otherServerId);
        var maja = await app.ConnectAsync("maja");

        await maja.JoinAsync(Salon);
        var joined = await observer["VoiceParticipantChanged"].NextAsync(InRoom(Salon));
        await maja.LeaveAsync();
        var left = await observer["VoiceParticipantChanged"].NextAsync(InRoom(Salon));

        Assert.Equal([maja.Id.ToString()], Occupants(joined));
        Assert.Empty(Occupants(left));
        Assert.True(joined.GetProperty("sequence").GetInt64() > 0);
        Assert.True(left.GetProperty("sequence").GetInt64() > joined.GetProperty("sequence").GetInt64());
        await elsewhere.SettleAsync();
        Assert.Empty(elsewhere["VoiceParticipantChanged"].Drain());
    }

    [Fact]
    public async Task JoiningIsRefusedForRoomsTheAccountCannotUse()
    {
        await using var app = new VoiceApp();
        var (_, foreignVoiceId) = await app.AddServerAsync(Accounts["nils"].Id);
        var ilya = await app.ConnectAsync("ilya");

        foreach (var room in new[]
        {
            TestData.GeneralChannelId.ToString(),
            foreignVoiceId.ToString(),
            Guid.NewGuid().ToString(),
        })
        {
            await RefusedAsync("Unknown voice room.", ilya.JoinAsync(room));
        }
        await RefusedAsync("Invalid channelId.", ilya.JoinAsync("not-a-guid"));
        Assert.Empty(app.Presence.ActiveVoiceRoomIds());
    }

    [Fact]
    public async Task ARoomAtItsUserLimitRefusesNewcomersButNotThoseInIt()
    {
        await using var app = new VoiceApp();
        app.Seed(db => db.Channels.Single(x => x.Id == TestData.VoiceChannelId).UserLimit = 1);
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");

        await maja.JoinAsync(Salon);
        await RefusedAsync("Voice room is full.", ada.JoinAsync(Salon));
        await maja.JoinAsync(Salon);
        Assert.Equal([maja.Id], app.Presence.VoiceUsers(TestData.VoiceChannelId).Select(x => x.UserId));

        await maja.LeaveAsync();
        await ada.JoinAsync(Salon);
        Assert.Equal([ada.Id], app.Presence.VoiceUsers(TestData.VoiceChannelId).Select(x => x.UserId));
    }

    [Fact]
    public async Task ANewerConnectionOfTheSameAccountReplacesTheOlderOne()
    {
        await using var app = new VoiceApp();
        var observer = await app.ConnectAsync("jo");
        var older = await app.ConnectAsync("maja");
        var newer = await app.ConnectAsync("maja");

        await older.JoinAsync(Salon);
        await newer.JoinAsync(Salon);

        var notice = await older["VoiceSessionReplaced"].NextAsync();
        Assert.Equal(Salon, notice.GetProperty("channelId").GetString());
        await RefusedAsync("Invalid voice signal.", older.SignalAsync(Salon, "state", """{"muted":false}"""));
        Assert.Equal(
            [newer.Connection.ConnectionId!],
            app.Presence.VoiceConnectionIds(TestData.VoiceChannelId));
        await newer.SettleAsync();
        Assert.Empty(newer["VoiceSessionReplaced"].Drain());

        await observer.SettleAsync();
        var latest = observer["VoiceParticipantChanged"].Drain().Last(InRoom(Salon));
        Assert.Equal([newer.Id.ToString()], Occupants(latest));
    }

    [Fact]
    public async Task ASignalReachesOnlyItsTargetAndABroadcastEveryoneElseInTheRoom()
    {
        await using var app = new VoiceApp();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var ilya = await app.ConnectAsync("ilya");
        var outside = await app.ConnectAsync("jo");
        foreach (var peer in new[] { maja, ada, ilya })
        {
            await peer.JoinAsync(Salon);
        }

        // A newcomer is told the state of those already there, one by one.
        const string screen = """{"screenStreamId":"screen-1"}""";
        await maja.SignalAsync(Salon, "state", screen, toUserId: ada.Id.ToString());
        var targeted = await ada["VoiceSignal"].NextAsync();
        Assert.Equal(1, targeted.GetProperty("protocolVersion").GetInt32());
        Assert.Equal(Salon, targeted.GetProperty("channelId").GetString());
        Assert.Equal(maja.Id.ToString(), targeted.GetProperty("fromUserId").GetString());
        Assert.Equal(ada.Id.ToString(), targeted.GetProperty("toUserId").GetString());
        Assert.Equal("state", targeted.GetProperty("kind").GetString());
        Assert.Equal(screen, targeted.GetProperty("payload").GetString());
        await AssertNoSignalAsync(maja, ilya, outside);

        await maja.SignalAsync(Salon, "state", """{"screenStreamId":null}""");
        foreach (var peer in new[] { ada, ilya })
        {
            var broadcast = await peer["VoiceSignal"].NextAsync();
            Assert.Equal("state", broadcast.GetProperty("kind").GetString());
            Assert.Equal(JsonValueKind.Null, broadcast.GetProperty("toUserId").ValueKind);
        }
        await AssertNoSignalAsync(maja, outside);
    }

    [Fact]
    public async Task AnInvalidSignalIsRefusedAndReachesNobody()
    {
        await using var app = new VoiceApp();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var outside = await app.ConnectAsync("jo");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);

        const string refused = "Invalid voice signal.";
        await RefusedAsync(refused, maja.SignalAsync(Salon, "hello", "{}"));
        await RefusedAsync(refused, maja.SignalAsync(Salon, "state", "{}", version: 2));
        await RefusedAsync(refused, maja.SignalAsync(Salon, "state", StateOfLength(RtcProtocol.MaxSignalBytes + 1)));
        await RefusedAsync(refused, maja.SignalAsync(NightShift, "state", "{}"));
        await RefusedAsync(refused, outside.SignalAsync(Salon, "state", "{}"));
        await RefusedAsync("Invalid ChannelId.", maja.SignalAsync("not-a-guid", "state", "{}"));
        await RefusedAsync(
            "Voice signal target is not in this channel.",
            maja.SignalAsync(Salon, "state", "{}", toUserId: outside.Id.ToString()));
        await RefusedAsync(
            "Voice signal target is not in this channel.",
            maja.SignalAsync(Salon, "state", "{}", toUserId: "nobody"));
        await RefusedAsync("Invalid voice state.", maja.SignalAsync(Salon, "state", "{not json"));
        await RefusedAsync("Invalid voice state.", maja.SignalAsync(Salon, "state", "[true]"));

        await AssertNoSignalAsync(ada, outside);

        // A refusal leaves the connection and its seat as they were.
        await maja.SignalAsync(Salon, "state", "{}");
        Assert.Equal("state", (await ada["VoiceSignal"].NextAsync()).GetProperty("kind").GetString());
    }

    [Fact]
    public async Task APayloadOfExactlyTheLimitIsRelayed()
    {
        await using var app = new VoiceApp();
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);

        await maja.SignalAsync(Salon, "state", StateOfLength(RtcProtocol.MaxSignalBytes));

        var relayed = await ada["VoiceSignal"].NextAsync();
        Assert.Equal(RtcProtocol.MaxSignalBytes, relayed.GetProperty("payload").GetString()!.Length);
    }

    /// <summary>A state that says nothing about muting, padded to exactly <paramref name="bytes"/> bytes.</summary>
    private static string StateOfLength(int bytes)
    {
        const string head = "{\"pad\":\"";
        const string tail = "\"}";
        return head + new string('x', bytes - head.Length - tail.Length) + tail;
    }

    [Fact]
    public async Task AStateSignalWithMutedChangesTheOccupancyOthersSee()
    {
        await using var app = new VoiceApp();
        var observer = await app.ConnectAsync("jo");
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        await maja.JoinAsync(Salon);
        await ada.JoinAsync(Salon);

        const string muted = """{"muted":true,"screenStreamId":null}""";
        await maja.SignalAsync(Salon, "state", muted);
        await observer["VoiceParticipantChanged"].NextAsync(x => InRoom(Salon)(x) && IsMuted(x, maja.Id));
        Assert.Equal(muted, (await ada["VoiceSignal"].NextAsync()).GetProperty("payload").GetString());
        Assert.True(app.Presence.VoiceUsers(TestData.VoiceChannelId).Single(x => x.UserId == maja.Id).Muted);

        const string unmuted = """{"muted":false}""";
        await maja.SignalAsync(Salon, "state", unmuted);
        await observer["VoiceParticipantChanged"].NextAsync(x => InRoom(Salon)(x) && !IsMuted(x, maja.Id));
        Assert.Equal(unmuted, (await ada["VoiceSignal"].NextAsync()).GetProperty("payload").GetString());

        // A state that says nothing about muting is relayed and changes no seat.
        await observer.SettleAsync();
        observer["VoiceParticipantChanged"].Drain();
        const string screen = """{"screenStreamId":"s1"}""";
        await maja.SignalAsync(Salon, "state", screen);
        Assert.Equal(screen, (await ada["VoiceSignal"].NextAsync()).GetProperty("payload").GetString());
        await observer.SettleAsync();
        Assert.Empty(observer["VoiceParticipantChanged"].Drain());
    }

    [Fact]
    public async Task LeavingVoiceFreesTheSeat()
    {
        await using var app = new VoiceApp();
        var observer = await app.ConnectAsync("jo");
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);

        await maja.LeaveAsync();

        var emptied = await observer["VoiceParticipantChanged"].NextAsync(x => InRoom(Salon)(x) && Occupants(x).Length == 0);
        Assert.Empty(Occupants(emptied));
        Assert.Empty(app.Presence.VoiceUsers(TestData.VoiceChannelId));
        await RefusedAsync("Invalid voice signal.", maja.SignalAsync(Salon, "state", """{"muted":false}"""));

        // Leaving without a seat is not an error and announces nothing.
        await observer.SettleAsync();
        observer["VoiceParticipantChanged"].Drain();
        await maja.LeaveAsync();
        await observer.SettleAsync();
        Assert.Empty(observer["VoiceParticipantChanged"].Drain());
    }

    [Fact]
    public async Task ADroppedConnectionFreesItsSeat()
    {
        await using var app = new VoiceApp();
        var observer = await app.ConnectAsync("jo");
        var maja = await app.ConnectAsync("maja");
        await maja.JoinAsync(Salon);
        await observer["VoiceParticipantChanged"].NextAsync(InRoom(Salon));

        await maja.Connection.StopAsync();

        var emptied = await observer["VoiceParticipantChanged"].NextAsync(x => InRoom(Salon)(x) && Occupants(x).Length == 0);
        Assert.Empty(Occupants(emptied));
        Assert.Empty(app.Presence.VoiceUsers(TestData.VoiceChannelId));
    }

    private static Func<JsonElement, bool> InRoom(string room) =>
        payload => payload.GetProperty("channelId").GetString() == room;

    private static bool IsMuted(JsonElement snapshot, Guid userId) =>
        snapshot.GetProperty("participants").EnumerateArray().Any(x =>
            x.GetProperty("userId").GetString() == userId.ToString() && x.GetProperty("muted").GetBoolean());

    private static string[] Occupants(JsonElement snapshot) =>
        [.. snapshot.GetProperty("participants").EnumerateArray().Select(x => x.GetProperty("userId").GetString()!)];

    /// <summary>The refusal a hub method raises, which the client sees as an exception that carries its text.</summary>
    private static async Task RefusedAsync(string message, Task call)
    {
        var failure = await Assert.ThrowsAsync<HubException>(() => call);
        Assert.Contains(message, failure.Message);
    }

    /// <summary>Asks each peer for something and so waits until what the server sent it before has arrived.</summary>
    private static async Task AssertNoSignalAsync(params Peer[] peers)
    {
        foreach (var peer in peers)
        {
            await peer.SettleAsync();
            Assert.Empty(peer["VoiceSignal"].Drain());
        }
    }

    /// <summary>An application of its own, and the hub connections opened against it.</summary>
    /// <param name="mediaServer">
    /// Stands in for Stellarr Media, for a test that looks at what the API asks
    /// of it. Without one the application gets the factory's own.
    /// </param>
    private sealed class VoiceApp(FakeMediaServer? mediaServer = null) : IAsyncDisposable
    {
        private readonly StellarrWebApplicationFactory _factory = new(
            loadTestData: true,
            configureServices: services => mediaServer?.Install(services));
        private readonly List<Peer> _peers = [];

        public PresenceTracker Presence => _factory.Services.GetRequiredService<PresenceTracker>();

        public T Service<T>() where T : notnull => _factory.Services.GetRequiredService<T>();

        /// <summary>Waits until the event pump has reset the media server, before which no session opens.</summary>
        public async Task MediaReadyAsync()
        {
            using var timeout = new CancellationTokenSource(Patience);
            while (!Service<MediaPlane>().IsReady)
            {
                await Task.Delay(10, timeout.Token);
            }
        }

        /// <summary>A signed-in HTTP client, for the endpoints that change seats.</summary>
        public async Task<HttpClient> HttpAsync(string username)
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = true,
            });
            (await client.PostAsJsonAsync(
                "/api/auth/login",
                new { username, password = Accounts[username].Password })).EnsureSuccessStatusCode();
            return client;
        }

        public async Task<Peer> ConnectAsync(string username, Guid? serverId = null)
        {
            var peer = new Peer(Accounts[username].Id, Connection(await SignInAsync(username), serverId));
            _peers.Add(peer);
            await peer.StartAsync();
            return peer;
        }

        public void Seed(Action<AppDbContext> change)
        {
            using var scope = _factory.OpenScope(out var db);
            change(db);
            db.SaveChanges();
        }

        /// <summary>Adds a server with one voice channel, which only <paramref name="memberId"/> belongs to.</summary>
        public async Task<(Guid ServerId, Guid VoiceChannelId)> AddServerAsync(Guid memberId)
        {
            await using var scope = _factory.OpenScope(out var db);
            var server = new StellarrServer { Id = Guid.NewGuid(), Name = "Zenith", CreatedAt = DateTime.UtcNow };
            var role = new ServerRole
            {
                Id = Guid.NewGuid(),
                ServerId = server.Id,
                Name = "Członek",
                Color = "#777777",
                IsSystem = true,
            };
            var channel = new Channel { Id = Guid.NewGuid(), ServerId = server.Id, Name = "Rozmowa", Kind = ChannelKind.Voice };
            db.Servers.Add(server);
            db.ServerRoles.Add(role);
            db.Channels.Add(channel);
            db.ServerMembers.Add(new ServerMember
            {
                ServerId = server.Id,
                UserId = memberId,
                RoleId = role.Id,
                JoinedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return (server.Id, channel.Id);
        }

        public async ValueTask DisposeAsync()
        {
            foreach (var peer in _peers)
            {
                await peer.DisposeAsync();
            }
            _factory.Dispose();
        }

        private HubConnection Connection(string cookie, Guid? serverId) => new HubConnectionBuilder()
            .WithUrl(
                serverId is null ? "https://localhost/hubs/app" : $"https://localhost/hubs/app?serverId={serverId}",
                options =>
                {
                    options.Headers["Cookie"] = cookie;
                    options.Transports = HttpTransportType.LongPolling;
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                })
            .Build();

        /// <summary>Signs in and returns the cookies the server set, as a Cookie header.</summary>
        private async Task<string> SignInAsync(string username)
        {
            using var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = false,
            });
            using var response = await client.PostAsJsonAsync(
                "/api/auth/login",
                new { username, password = Accounts[username].Password });
            response.EnsureSuccessStatusCode();
            return string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        }
    }

    /// <summary>One signed-in hub connection and everything the server pushed to it.</summary>
    private sealed class Peer : IAsyncDisposable
    {
        private static readonly string[] Events =
        [
            "PresenceChanged", "VoiceParticipantChanged", "VoiceSignal", "VoiceSessionReplaced", "DirectCallDeclined",
            "VoiceChannelKicked", "VoiceChannelMoved", "MediaSignal", "MediaSessionClosed",
        ];

        private readonly Dictionary<string, Inbox> _inboxes = [];

        public Peer(Guid id, HubConnection connection)
        {
            Id = id;
            Connection = connection;
            foreach (var name in Events)
            {
                var inbox = new Inbox();
                _inboxes[name] = inbox;
                connection.On<JsonElement>(name, inbox.Add);
            }
        }

        public Guid Id { get; }

        public HubConnection Connection { get; }

        public Inbox this[string eventName] => _inboxes[eventName];

        /// <summary>
        /// Starts the connection and waits until the hub has finished placing it
        /// in its groups, which it announces by telling the account its own status.
        /// </summary>
        public async Task StartAsync()
        {
            await Connection.StartAsync();
            await this["PresenceChanged"].NextAsync(x => x.GetProperty("userId").GetString() == Id.ToString());
        }

        public Task JoinAsync(string room) => Connection.InvokeAsync("JoinVoice", room);

        public Task LeaveAsync() => Connection.InvokeAsync("LeaveVoice");

        public Task SignalAsync(
            string room,
            string kind,
            string payload,
            string? toUserId = null,
            int version = RtcProtocol.Version) =>
            Connection.InvokeAsync("SendVoiceSignal", new
            {
                protocolVersion = version,
                channelId = room,
                toUserId,
                kind,
                payload,
            });

        /// <summary>Opens the media session of this connection's seat and returns its id.</summary>
        public async Task<string> OpenMediaAsync(string room) =>
            (await Connection.InvokeAsync<JsonElement>("OpenMediaSession", room)).GetProperty("sessionId").GetString()!;

        public Task MediaSignalAsync(
            string room,
            string? sessionId,
            string? kind,
            string? payload,
            int version = RtcProtocol.Version) =>
            Connection.InvokeAsync("SendMediaSignal", new
            {
                protocolVersion = version,
                channelId = room,
                sessionId,
                kind,
                payload,
            });

        /// <summary>
        /// A round trip. Whatever the server sent this connection before it was
        /// asked has been delivered by the time it is answered.
        /// </summary>
        public async Task SettleAsync() => await Connection.InvokeAsync<long>("GetRtcClock");

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }

    /// <summary>Events one connection received, in order.</summary>
    private sealed class Inbox
    {
        private readonly System.Threading.Channels.Channel<JsonElement> _events =
            System.Threading.Channels.Channel.CreateUnbounded<JsonElement>();

        public void Add(JsonElement payload) => _events.Writer.TryWrite(payload);

        /// <summary>The next event that <paramref name="accept"/> takes, waiting for it; events before it are dropped.</summary>
        public async Task<JsonElement> NextAsync(Func<JsonElement, bool>? accept = null)
        {
            using var timeout = new CancellationTokenSource(Patience);
            while (true)
            {
                var next = await _events.Reader.ReadAsync(timeout.Token);
                if (accept is null || accept(next))
                {
                    return next;
                }
            }
        }

        /// <summary>Takes what has arrived and not been read yet.</summary>
        public List<JsonElement> Drain()
        {
            var pending = new List<JsonElement>();
            while (_events.Reader.TryRead(out var next))
            {
                pending.Add(next);
            }
            return pending;
        }
    }
}
