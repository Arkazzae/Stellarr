using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Stellarr.Api.Tests;

public sealed class SignalRFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string GeneralChannelId = "20000000-0000-0000-0000-000000000001";
    private const string SalonChannelId = "20000000-0000-0000-0000-000000000002";
    private const string MajaId = "30000000-0000-0000-0000-000000000001";
    private const string AdaId = "30000000-0000-0000-0000-000000000002";
    private const string JoId = "30000000-0000-0000-0000-000000000005";
    private readonly StellarrWebApplicationFactory _factory;

    public SignalRFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task ConnectingUserReceivesOwnOnlinePresence()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var cookieHeader = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));

        await using var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookieHeader;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
            })
            .Build();

        var presence = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JsonElement>("PresenceChanged", payload => presence.TrySetResult(payload));

        await connection.StartAsync();
        var update = await presence.Task.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(MajaId, update.GetProperty("userId").GetString());
        Assert.Equal("online", update.GetProperty("presence").GetString());
        await connection.StopAsync();
    }

    [Fact]
    public async Task ChosenPresenceIsBroadcastToEveryConnectedUser()
    {
        await using var observer = await BuildConnectionAsync("ada", "Quasar!2026");
        await observer.StartAsync();

        await using var actor = await BuildConnectionAsync("maja", "Aurora!2026");
        var observed = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = observer.On<JsonElement>("PresenceChanged", payload =>
        {
            if (payload.GetProperty("userId").GetString() == MajaId &&
                payload.GetProperty("presence").GetString() == "dnd")
            {
                observed.TrySetResult(payload);
            }
        });

        await actor.StartAsync();
        await actor.InvokeAsync("SetPresence", "dnd");

        var update = await observed.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(MajaId, update.GetProperty("userId").GetString());
        Assert.Equal("dnd", update.GetProperty("presence").GetString());
        await actor.InvokeAsync("SetPresence", "online");
    }

    [Fact]
    public async Task MessagesArePushedWithoutOpeningTheirChannel()
    {
        await using var observer = await BuildConnectionAsync("ada", "Quasar!2026");
        var received = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = observer.On<JsonElement>("MessageCreated", payload =>
        {
            if (payload.GetProperty("content").GetString() == "realtime-all-channels")
            {
                received.TrySetResult(payload);
            }
        });
        await observer.StartAsync();

        using var sender = await CreateAuthenticatedClientAsync("maja", "Aurora!2026");
        var response = await sender.PostAsJsonAsync(
            $"/api/channels/{GeneralChannelId}/messages",
            new { content = "realtime-all-channels", attachmentIds = Array.Empty<string>() });
        response.EnsureSuccessStatusCode();

        var message = await received.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(GeneralChannelId, message.GetProperty("channelId").GetString());
        Assert.Equal(MajaId, message.GetProperty("author").GetProperty("id").GetString());
    }

    [Fact]
    public async Task TypingIsPushedToOtherServerMembers()
    {
        await using var observer = await BuildConnectionAsync("ada", "Quasar!2026");
        await using var actor = await BuildConnectionAsync("maja", "Aurora!2026");
        var received = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = observer.On<JsonElement>("TypingChanged", payload =>
        {
            if (payload.GetProperty("channelId").GetString() == GeneralChannelId)
            {
                received.TrySetResult(payload);
            }
        });
        await observer.StartAsync();
        await actor.StartAsync();

        await actor.InvokeAsync("SendTyping", GeneralChannelId);

        var typing = await received.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(MajaId, typing.GetProperty("userId").GetString());
        Assert.Equal("Maja", typing.GetProperty("displayName").GetString());
        Assert.True(typing.GetProperty("expiresAt").GetDateTime() > DateTime.UtcNow);
    }

    [Fact]
    public async Task ServerUpdatesAreGlobalButChannelReadsStayWithTheirUser()
    {
        await using var ada = await BuildConnectionAsync("ada", "Quasar!2026");
        await using var maja = await BuildConnectionAsync("maja", "Aurora!2026");
        var serverUpdated = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var readUpdated = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var readLeaked = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var serverSubscription = ada.On<JsonElement>(
            "ServerUpdated", payload => serverUpdated.TrySetResult(payload));
        using var ownReadSubscription = ada.On<JsonElement>(
            "ChannelReadChanged", payload => readUpdated.TrySetResult(payload));
        using var leakedReadSubscription = maja.On<JsonElement>(
            "ChannelReadChanged", payload => readLeaked.TrySetResult(payload));
        await ada.StartAsync();
        await maja.StartAsync();

        using var owner = await CreateAuthenticatedClientAsync("maja", "Aurora!2026");
        var serverResponse = await owner.PatchAsJsonAsync(
            "/api/admin/server",
            new { name = "Realtime Orbit", description = "live", isPublic = false });
        serverResponse.EnsureSuccessStatusCode();

        using var reader = await CreateAuthenticatedClientAsync("ada", "Quasar!2026");
        var readResponse = await reader.PutAsync(
            $"/api/channels/{GeneralChannelId}/read", content: null);
        readResponse.EnsureSuccessStatusCode();

        Assert.Equal(
            "Realtime Orbit",
            (await serverUpdated.Task.WaitAsync(TimeSpan.FromSeconds(2)))
                .GetProperty("name").GetString());
        Assert.Equal(
            GeneralChannelId,
            (await readUpdated.Task.WaitAsync(TimeSpan.FromSeconds(2)))
                .GetProperty("channelId").GetString());
        await Task.Delay(150);
        Assert.False(readLeaked.Task.IsCompleted);
    }

    [Fact]
    public async Task DirectMessagesArePushedOnlyToTheConversationParticipants()
    {
        await using var ada = await BuildConnectionAsync("ada", "Quasar!2026");
        await using var jo = await BuildConnectionAsync("jo", "Corona!2026");
        var received = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var leaked = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var adaSubscription = ada.On<JsonElement>(
            "DirectMessageCreated",
            payload => received.TrySetResult(payload));
        using var joSubscription = jo.On<JsonElement>(
            "DirectMessageCreated",
            payload => leaked.TrySetResult(payload));
        await ada.StartAsync();
        await jo.StartAsync();

        using var maja = await CreateAuthenticatedClientAsync("maja", "Aurora!2026");
        var opened = await maja.PostAsJsonAsync(
            "/api/social/conversations", new { userId = AdaId });
        opened.EnsureSuccessStatusCode();
        using var openedJson = JsonDocument.Parse(await opened.Content.ReadAsStringAsync());
        var conversationId = openedJson.RootElement.GetProperty("id").GetString();

        var response = await maja.PostAsJsonAsync(
            $"/api/social/conversations/{conversationId}/messages",
            new { content = "direct-realtime" });
        response.EnsureSuccessStatusCode();

        var message = await received.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(conversationId, message.GetProperty("channelId").GetString());
        Assert.Equal("direct-realtime", message.GetProperty("content").GetString());
        await Task.Delay(150);
        Assert.False(leaked.Task.IsCompleted);
    }

    [Fact]
    public async Task DirectConversationIsAPrivateAuthorizedRtcRoom()
    {
        using var client = await CreateAuthenticatedClientAsync("maja", "Aurora!2026");
        var opened = await client.PostAsJsonAsync(
            "/api/social/conversations", new { userId = AdaId });
        opened.EnsureSuccessStatusCode();
        using var openedJson = JsonDocument.Parse(await opened.Content.ReadAsStringAsync());
        var conversationId = openedJson.RootElement.GetProperty("id").GetString()!;

        await using var maja = await BuildConnectionAsync("maja", "Aurora!2026");
        await using var ada = await BuildConnectionAsync("ada", "Quasar!2026");
        await using var jo = await BuildConnectionAsync("jo", "Corona!2026");
        var occupancy = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var leaked = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var adaOccupancy = ada.On<JsonElement>("VoiceParticipantChanged", payload =>
        {
            if (payload.GetProperty("channelId").GetString() == conversationId)
            {
                occupancy.TrySetResult(payload);
            }
        });
        using var joOccupancy = jo.On<JsonElement>("VoiceParticipantChanged", payload =>
        {
            if (payload.GetProperty("channelId").GetString() == conversationId)
            {
                leaked.TrySetResult(payload);
            }
        });
        var signal = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var adaSignal = ada.On<JsonElement>("VoiceSignal", payload =>
        {
            if (payload.GetProperty("channelId").GetString() == conversationId)
            {
                signal.TrySetResult(payload);
            }
        });
        var declined = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var majaDeclined = maja.On<JsonElement>("DirectCallDeclined", payload =>
        {
            if (payload.GetProperty("channelId").GetString() == conversationId)
            {
                declined.TrySetResult(payload);
            }
        });

        await maja.StartAsync();
        await ada.StartAsync();
        await jo.StartAsync();
        await maja.InvokeAsync("JoinVoice", conversationId);

        var snapshot = await occupancy.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Contains(
            snapshot.GetProperty("participants").EnumerateArray(),
            participant => participant.GetProperty("userId").GetString() == MajaId);
        await Task.Delay(150);
        Assert.False(leaked.Task.IsCompleted);

        await Assert.ThrowsAnyAsync<Exception>(
            () => jo.InvokeAsync("JoinVoice", conversationId));

        await ada.InvokeAsync("JoinVoice", conversationId);
        await maja.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = conversationId,
            toUserId = AdaId,
            kind = "state",
            payload = "{\"screenStreamId\":\"private-test\"}",
        });
        var delivered = await signal.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(MajaId, delivered.GetProperty("fromUserId").GetString());

        await ada.InvokeAsync("DeclineDirectCall", conversationId);
        var declinedEvent = await declined.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(AdaId, declinedEvent.GetProperty("byUserId").GetString());
    }

    [Fact]
    public async Task VoicePresenceReachesObserversAndSignalsOnlyReachCallParticipants()
    {
        await using var observer = await BuildConnectionAsync("jo", "Corona!2026");
        await using var maja = await BuildConnectionAsync("maja", "Aurora!2026");
        await using var ada = await BuildConnectionAsync("ada", "Quasar!2026");

        var occupancy = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var occupancySubscription = observer.On<JsonElement>("VoiceParticipantChanged", payload =>
        {
            if (payload.GetProperty("channelId").GetString() == SalonChannelId &&
                payload.GetProperty("participants").EnumerateArray()
                    .Any(participant => participant.GetProperty("userId").GetString() == MajaId))
            {
                occupancy.TrySetResult(payload);
            }
        });
        var signal = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var signalSubscription = ada.On<JsonElement>("VoiceSignal", payload =>
        {
            if (payload.GetProperty("kind").GetString() == "state")
            {
                signal.TrySetResult(payload);
            }
        });

        await observer.StartAsync();
        await maja.StartAsync();
        await ada.StartAsync();
        await maja.InvokeAsync("JoinVoice", SalonChannelId);

        var publicSnapshot = await occupancy.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(publicSnapshot.GetProperty("sequence").GetInt64() > 0);
        Assert.Contains(
            publicSnapshot.GetProperty("participants").EnumerateArray(),
            participant => participant.GetProperty("userId").GetString() == MajaId);

        await ada.InvokeAsync("JoinVoice", SalonChannelId);
        await maja.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = SalonChannelId,
            toUserId = AdaId,
            kind = "state",
            payload = "{\"screenStreamId\":\"test\"}",
        });

        var delivered = await signal.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(MajaId, delivered.GetProperty("fromUserId").GetString());
        Assert.Equal(AdaId, delivered.GetProperty("toUserId").GetString());

        await Assert.ThrowsAnyAsync<Exception>(() => maja.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = SalonChannelId,
            toUserId = JoId,
            kind = "state",
            payload = "{\"screenStreamId\":\"test\"}",
        }));
    }

    [Fact]
    public async Task NewerVoiceTabReplacesTheOlderSessionForTheSameAccount()
    {
        await using var older = await BuildConnectionAsync("maja", "Aurora!2026");
        await using var newer = await BuildConnectionAsync("maja", "Aurora!2026");
        var replaced = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = older.On<JsonElement>(
            "VoiceSessionReplaced",
            payload => replaced.TrySetResult(payload));

        await older.StartAsync();
        await newer.StartAsync();
        await older.InvokeAsync("JoinVoice", SalonChannelId);
        await newer.InvokeAsync("JoinVoice", SalonChannelId);

        var notice = await replaced.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(SalonChannelId, notice.GetProperty("channelId").GetString());

        await Assert.ThrowsAnyAsync<Exception>(() => older.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = SalonChannelId,
            toUserId = (string?)null,
            kind = "state",
            payload = "{\"muted\":false,\"screenStreamId\":null}",
        }));
    }

    [Fact]
    public async Task AuthenticatedUserCanJoinVoiceThroughOwnSignalingHub()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var cookieHeader = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));

        await using var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookieHeader;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
            })
            .Build();

        var occupancy = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JsonElement>("VoiceParticipantChanged", payload => occupancy.TrySetResult(payload));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinVoice", SalonChannelId);
        var snapshot = await occupancy.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(SalonChannelId, snapshot.GetProperty("channelId").GetString());
        Assert.Contains(
            snapshot.GetProperty("participants").EnumerateArray(),
            participant => participant.GetProperty("userId").GetString() == MajaId);

        await connection.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = SalonChannelId,
            toUserId = (string?)null,
            kind = "state",
            payload = "{\"muted\":false,\"screenStreamId\":null}",
        });

        await Assert.ThrowsAnyAsync<Exception>(() => connection.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 999,
            channelId = SalonChannelId,
            toUserId = (string?)null,
            kind = "state",
            payload = "{\"muted\":false,\"screenStreamId\":null}",
        }));

        var departure = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var departureSubscription = connection.On<JsonElement>(
            "VoiceParticipantChanged",
            payload =>
            {
                if (payload.GetProperty("participants").GetArrayLength() == 0)
                {
                    departure.TrySetResult(payload);
                }
            });

        await connection.InvokeAsync("LeaveVoice");
        var emptySnapshot = await departure.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(SalonChannelId, emptySnapshot.GetProperty("channelId").GetString());
        await connection.StopAsync();
    }

    [Fact]
    public async Task HiddenPresenceStaysOfflineToObserversButNotToTheAccountOwner()
    {
        using var account = await CreateAuthenticatedClientAsync("maja", "Aurora!2026");
        (await account.PatchAsJsonAsync(
            "/api/me/preferences",
            new { showPresence = false })).EnsureSuccessStatusCode();

        await using var observer = await BuildConnectionAsync("ada", "Quasar!2026");
        await using var actor = await BuildConnectionAsync("maja", "Aurora!2026");
        var observerReady = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var hidden = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = observer.On<JsonElement>("PresenceChanged", payload =>
        {
            var userId = payload.GetProperty("userId").GetString();
            if (userId == AdaId)
            {
                observerReady.TrySetResult();
            }
            else if (userId == MajaId && payload.GetProperty("presence").GetString() == "offline")
            {
                hidden.TrySetResult(payload);
            }
        });

        try
        {
            // StartAsync returns after the handshake, before the hub has put
            // the observer in its server's group. The hub sends a connection
            // its own presence last, so once that arrives the observer is in
            // the group and cannot miss the actor's announcement.
            await observer.StartAsync();
            await observerReady.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await actor.StartAsync();
            await hidden.Task.WaitAsync(TimeSpan.FromSeconds(2));
            await actor.InvokeAsync("SetPresence", "dnd");

            using var observerClient = await CreateAuthenticatedClientAsync("ada", "Quasar!2026");
            var observerBootstrap = await observerClient.GetFromJsonAsync<JsonElement>("/api/bootstrap");
            var maja = observerBootstrap.GetProperty("members").EnumerateArray()
                .Single(member => member.GetProperty("id").GetString() == MajaId);
            Assert.Equal("offline", maja.GetProperty("presence").GetString());

            var ownBootstrap = await account.GetFromJsonAsync<JsonElement>("/api/bootstrap");
            Assert.Equal("dnd", ownBootstrap.GetProperty("user").GetProperty("presence").GetString());
        }
        finally
        {
            if (actor.State == HubConnectionState.Connected)
            {
                await actor.InvokeAsync("SetPresence", "online");
            }
            (await account.PatchAsJsonAsync(
                "/api/me/preferences",
                new { showPresence = true })).EnsureSuccessStatusCode();
        }
    }

    [Fact]
    public async Task VoiceChannelRejectsAJoinWhenItsUserLimitIsReached()
    {
        using var owner = await CreateAuthenticatedClientAsync("maja", "Aurora!2026");
        (await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{SalonChannelId}",
            new { userLimit = 1 })).EnsureSuccessStatusCode();
        await using var maja = await BuildConnectionAsync("maja", "Aurora!2026");
        await using var ada = await BuildConnectionAsync("ada", "Quasar!2026");

        try
        {
            await maja.StartAsync();
            await ada.StartAsync();
            await maja.InvokeAsync("JoinVoice", SalonChannelId);

            await Assert.ThrowsAnyAsync<Exception>(
                () => ada.InvokeAsync("JoinVoice", SalonChannelId));
        }
        finally
        {
            if (maja.State == HubConnectionState.Connected)
            {
                await maja.InvokeAsync("LeaveVoice");
            }
            (await owner.PatchAsJsonAsync(
                $"/api/admin/channels/{SalonChannelId}",
                new { userLimit = 0 })).EnsureSuccessStatusCode();
        }
    }

    private async Task<HubConnection> BuildConnectionAsync(string username, string password)
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        login.EnsureSuccessStatusCode();
        var cookieHeader = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));

        return new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookieHeader;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
            })
            .Build();
    }

    private async Task<HttpClient> CreateAuthenticatedClientAsync(string username, string password)
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        login.EnsureSuccessStatusCode();
        return client;
    }
}
