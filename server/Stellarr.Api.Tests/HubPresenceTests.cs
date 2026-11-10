using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed class HubPresenceTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private static readonly Dictionary<string, (Guid Id, string Password)> Accounts = new()
    {
        ["maja"] = (Guid.Parse("30000000-0000-0000-0000-000000000001"), "Aurora!2026"),
        ["ada"] = (Guid.Parse("30000000-0000-0000-0000-000000000002"), "Quasar!2026"),
        ["ilya"] = (Guid.Parse("30000000-0000-0000-0000-000000000003"), "Meteor!2026"),
        ["nils"] = (Guid.Parse("30000000-0000-0000-0000-000000000004"), "Zenith!2026"),
        ["jo"] = (Guid.Parse("30000000-0000-0000-0000-000000000005"), "Corona!2026"),
    };

    [Fact]
    public async Task ConnectingAccountIsToldItsOwnStatus()
    {
        await using var connection = await BuildAsync("ilya");
        var own = Listen(connection, "PresenceChanged");

        await connection.StartAsync();

        var update = await own.Next();
        Assert.Equal(Accounts["ilya"].Id.ToString(), update.GetProperty("userId").GetString());
        Assert.Equal("online", update.GetProperty("presence").GetString());
    }

    [Fact]
    public async Task OthersSeeAnAccountComeOnlineAndGoOffline()
    {
        await using var observer = await BuildAsync("ada");
        await using var actor = await BuildAsync("jo");
        var seen = Listen(observer, "PresenceChanged", Concerns("jo"));
        await StartAsync(observer, "ada");

        await actor.StartAsync();
        Assert.Equal("online", (await seen.Next()).GetProperty("presence").GetString());

        await actor.StopAsync();
        Assert.Equal("offline", (await seen.Next()).GetProperty("presence").GetString());
    }

    [Fact]
    public async Task AnotherConnectionOfAnOnlineAccountIsNotAnnouncedAgain()
    {
        await using var observer = await BuildAsync("ada");
        await using var first = await BuildAsync("ilya");
        await using var second = await BuildAsync("ilya");
        var seen = Listen(observer, "PresenceChanged", Concerns("ilya"));
        var secondOwn = Listen(second, "PresenceChanged");
        await StartAsync(observer, "ada");
        await StartAsync(first, "ilya");
        Assert.Equal("online", (await seen.Next()).GetProperty("presence").GetString());

        await second.StartAsync();
        Assert.Equal("online", (await secondOwn.Next()).GetProperty("presence").GetString());

        // Whatever the observer was sent before this change would arrive ahead of it.
        try
        {
            await second.InvokeAsync("SetPresence", "idle");
            Assert.Equal("idle", (await seen.Next()).GetProperty("presence").GetString());
        }
        finally
        {
            await second.InvokeAsync("SetPresence", "online");
        }
    }

    [Fact]
    public async Task ChosenStatusReachesOtherMembersAndTheCaller()
    {
        await using var observer = await BuildAsync("ada");
        await using var actor = await BuildAsync("maja");
        var seenByObserver = Listen(observer, "PresenceChanged", Concerns("maja", "dnd"));
        var seenByActor = Listen(actor, "PresenceChanged", Concerns("maja", "dnd"));
        await StartAsync(observer, "ada");
        await StartAsync(actor, "maja");

        try
        {
            await actor.InvokeAsync("SetPresence", "dnd");

            await seenByObserver.Next();
            await seenByActor.Next();
        }
        finally
        {
            await actor.InvokeAsync("SetPresence", "online");
        }
    }

    [Fact]
    public async Task UnknownStatusIsRefusedAndChangesNothing()
    {
        await using var connection = await BuildAsync("nils");
        await connection.StartAsync();

        var refused = await Assert.ThrowsAsync<HubException>(
            () => connection.InvokeAsync("SetPresence", "invisible"));

        Assert.Contains("Unknown presence.", refused.Message);
        Assert.Equal("online", factory.Services.GetRequiredService<PresenceTracker>().PresenceOf(Accounts["nils"].Id));
    }

    [Fact]
    public async Task AccountThatHidesItsStatusIsOfflineToOthersButOnlineToItself()
    {
        await using var observer = await BuildAsync("ada");
        await using var actor = await BuildAsync("jo");
        var seenByObserver = Listen(observer, "PresenceChanged", Concerns("jo"));
        var seenByActor = Listen(actor, "PresenceChanged", Concerns("jo", "online"));
        await SetShowPresenceAsync("jo", show: false);
        await StartAsync(observer, "ada");

        try
        {
            await actor.StartAsync();

            Assert.Equal("offline", (await seenByObserver.Next()).GetProperty("presence").GetString());
            await seenByActor.Next();
            await actor.InvokeAsync<long>("GetRtcClock");
            Assert.Equal(0, seenByObserver.Pending);
        }
        finally
        {
            await SetShowPresenceAsync("jo", show: true);
        }
    }

    [Fact]
    public async Task TypingReachesOtherMembersButNotTheSender()
    {
        await using var observer = await BuildAsync("ada");
        await using var sender = await BuildAsync("jo");
        var seenByObserver = Listen(observer, "TypingChanged");
        var seenBySender = Listen(sender, "TypingChanged");
        await StartAsync(observer, "ada");
        await StartAsync(sender, "jo");

        await sender.InvokeAsync("SendTyping", TestData.GeneralChannelId.ToString());

        var typing = await seenByObserver.Next();
        Assert.Equal(TestData.GeneralChannelId.ToString(), typing.GetProperty("channelId").GetString());
        Assert.Equal(Accounts["jo"].Id.ToString(), typing.GetProperty("userId").GetString());
        Assert.Equal("Jo", typing.GetProperty("displayName").GetString());
        Assert.True(typing.GetProperty("expiresAt").GetDateTime() > DateTime.UtcNow);
        await sender.InvokeAsync<long>("GetRtcClock");
        Assert.Equal(0, seenBySender.Pending);
    }

    [Fact]
    public async Task TypingIsRefusedForVoiceChannelsAndForeignServers()
    {
        var (_, foreignChannelId) = await AddServerAsync();
        await using var connection = await BuildAsync("ilya");
        await connection.StartAsync();

        foreach (var channelId in new[] { TestData.VoiceChannelId, foreignChannelId, Guid.NewGuid() })
        {
            await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync("SendTyping", channelId.ToString()));
        }
        await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync("SendTyping", "not-a-guid"));
    }

    [Fact]
    public async Task JoiningATextChannelSubscribesTheConnectionToIt()
    {
        await using var joined = await BuildAsync("ada");
        await using var bystander = await BuildAsync("ilya");
        var seenByJoined = Listen(joined, "Probe");
        var seenByBystander = Listen(bystander, "Probe");
        await StartAsync(joined, "ada");
        await StartAsync(bystander, "ilya");

        await joined.InvokeAsync("JoinChannel", TestData.ProjectsChannelId.ToString());
        await factory.Services.GetRequiredService<IHubContext<AppHub>>()
            .Clients.Group(AppHub.ChannelGroup(TestData.ProjectsChannelId))
            .SendAsync("Probe", "hello");

        await seenByJoined.Next();
        await bystander.InvokeAsync<long>("GetRtcClock");
        Assert.Equal(0, seenByBystander.Pending);
    }

    [Fact]
    public async Task JoiningIsRefusedForVoiceChannelsForeignServersAndNonsense()
    {
        var (_, foreignChannelId) = await AddServerAsync();
        await using var connection = await BuildAsync("ilya");
        await connection.StartAsync();

        foreach (var channelId in new[] { TestData.VoiceChannelId, foreignChannelId, Guid.NewGuid() })
        {
            var refused = await Assert.ThrowsAsync<HubException>(
                () => connection.InvokeAsync("JoinChannel", channelId.ToString()));
            Assert.Contains("Unknown channel.", refused.Message);
        }
        await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync("JoinChannel", "not-a-guid"));
    }

    [Fact]
    public async Task ConnectionFollowsOneServerOfItsOwnPreferringTheOneItAskedFor()
    {
        var (otherServerId, _) = await AddServerAsync(Accounts["nils"].Id);
        var (foreignServerId, _) = await AddServerAsync();
        await using var asked = await BuildAsync("nils", serverId: otherServerId);
        await using var askedForForeign = await BuildAsync("nils", serverId: foreignServerId);
        await using var unspecified = await BuildAsync("nils");
        var connections = new[] { asked, askedForForeign, unspecified };
        var inboxes = connections.Select(connection => Listen(connection, "Probe")).ToArray();
        await StartAsync(asked, "nils");
        await StartAsync(askedForForeign, "nils");
        await StartAsync(unspecified, "nils");

        var hub = factory.Services.GetRequiredService<IHubContext<AppHub>>();
        foreach (var serverId in new[] { TestData.ServerId, otherServerId, foreignServerId })
        {
            await hub.Clients.Group(AppHub.ServerGroup(serverId)).SendAsync("Probe", serverId.ToString());
        }

        // A connection follows exactly one server, so exactly one probe is meant for it. Which of
        // its own two servers an unspecific connection follows is not promised, only that it is one.
        Assert.Equal(otherServerId.ToString(), (await inboxes[0].Next()).GetString());
        foreach (var inbox in inboxes[1..])
        {
            Assert.Contains(
                (await inbox.Next()).GetString(),
                new[] { TestData.ServerId.ToString(), otherServerId.ToString() });
        }
        foreach (var (connection, inbox) in connections.Zip(inboxes))
        {
            await connection.InvokeAsync<long>("GetRtcClock");
            Assert.Equal(0, inbox.Pending);
        }
    }

    [Fact]
    public async Task HubRefusesAnonymousConnections()
    {
        await using var connection = Connection(cookie: null);

        await Assert.ThrowsAnyAsync<HttpRequestException>(() => connection.StartAsync());
    }

    [Fact]
    public async Task WebSocketOnlyConnectionStartsAndAnswersTheClockQuery()
    {
        var cookie = await SignInAsync("maja");
        await using var connection = Connection(cookie, HttpTransportType.WebSockets);

        await connection.StartAsync();
        var before = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var clock = await connection.InvokeAsync<long>("GetRtcClock");

        Assert.InRange(clock, before - 5_000, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 5_000);
    }

    /// <summary>A connection that is signed in as <paramref name="username"/> but not yet started.</summary>
    private async Task<HubConnection> BuildAsync(string username, Guid? serverId = null) =>
        Connection(await SignInAsync(username), serverId: serverId);

    private HubConnection Connection(
        string? cookie,
        HttpTransportType transport = HttpTransportType.LongPolling,
        Guid? serverId = null) => new HubConnectionBuilder()
            .WithUrl(
                serverId is null ? "https://localhost/hubs/app" : $"https://localhost/hubs/app?serverId={serverId}",
                options =>
                {
                    if (cookie is not null)
                    {
                        options.Headers["Cookie"] = cookie;
                    }
                    options.Transports = transport;
                    options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                    // The WebSocket handshake is not made through the handler above and carries no headers of its own.
                    options.WebSocketFactory = async (context, cancellationToken) =>
                    {
                        var socketClient = factory.Server.CreateWebSocketClient();
                        socketClient.ConfigureRequest = request =>
                        {
                            if (cookie is not null)
                            {
                                request.Headers.Cookie = cookie;
                            }
                        };
                        return await socketClient.ConnectAsync(context.Uri, cancellationToken);
                    };
                })
            .Build();

    /// <summary>Signs in and returns the cookies the server set, as a Cookie header.</summary>
    private async Task<string> SignInAsync(string username)
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
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

    /// <summary>
    /// Starts the connection and waits until the hub has finished with it. The client's start
    /// completes with the handshake, while the server is still placing the connection in its
    /// groups; the hub's first word about the account is sent when that is done.
    /// </summary>
    private static async Task StartAsync(HubConnection connection, string username)
    {
        var settled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = connection.On<JsonElement>("PresenceChanged", payload =>
        {
            if (Concerns(username)(payload))
            {
                settled.TrySetResult();
            }
        });

        await connection.StartAsync();
        await settled.Task.WaitAsync(Patience);
    }

    /// <summary>Predicate for the events that name <paramref name="username"/>, optionally with a given status.</summary>
    private static Func<JsonElement, bool> Concerns(string username, string? presence = null) => payload =>
        payload.GetProperty("userId").GetString() == Accounts[username].Id.ToString() &&
        (presence is null || payload.GetProperty("presence").GetString() == presence);

    private static Inbox Listen(HubConnection connection, string method, Func<JsonElement, bool>? accept = null)
    {
        var inbox = new Inbox();
        connection.On<JsonElement>(method, payload =>
        {
            if (accept is null || accept(payload))
            {
                inbox.Add(payload);
            }
        });
        return inbox;
    }

    private async Task SetShowPresenceAsync(string username, bool show)
    {
        await using var scope = factory.OpenScope(out var db);
        var userId = Accounts[username].Id;
        var preferences = await db.UserPreferences.SingleOrDefaultAsync(x => x.UserId == userId);
        if (preferences is null)
        {
            db.UserPreferences.Add(new UserPreferenceSettings { UserId = userId, ShowPresence = show });
        }
        else
        {
            preferences.ShowPresence = show;
        }
        await db.SaveChangesAsync();
    }

    /// <summary>Adds a server with one text channel that only <paramref name="memberIds"/> belong to.</summary>
    private async Task<(Guid ServerId, Guid ChannelId)> AddServerAsync(params Guid[] memberIds)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = new StellarrServer { Id = Guid.NewGuid(), Name = "Zenith", CreatedAt = DateTime.UtcNow };
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Członek",
            Color = "#777777",
            IsSystem = true,
        };
        var channel = new Channel { Id = Guid.NewGuid(), ServerId = server.Id, Name = "ogólny", Kind = ChannelKind.Text };
        db.Servers.Add(server);
        db.ServerRoles.Add(role);
        db.Channels.Add(channel);
        db.ServerMembers.AddRange(memberIds.Select(userId => new ServerMember
        {
            ServerId = server.Id,
            UserId = userId,
            RoleId = role.Id,
            JoinedAt = DateTime.UtcNow,
        }));
        await db.SaveChangesAsync();
        return (server.Id, channel.Id);
    }

    /// <summary>Events one connection received, in order, for a test to wait on.</summary>
    private sealed class Inbox
    {
        private readonly System.Threading.Channels.Channel<JsonElement> _events =
            System.Threading.Channels.Channel.CreateUnbounded<JsonElement>();

        /// <summary>Events that arrived and that the test has not asked for yet.</summary>
        public int Pending => _events.Reader.Count;

        public void Add(JsonElement payload) => _events.Writer.TryWrite(payload);

        /// <summary>The next event, waiting for it if it has not come.</summary>
        public async Task<JsonElement> Next() => await _events.Reader.ReadAsync().AsTask().WaitAsync(Patience);
    }
}
