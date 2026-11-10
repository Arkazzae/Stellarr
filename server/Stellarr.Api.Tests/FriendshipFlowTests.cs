using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Realtime;
using DirectConversation = Stellarr.Api.Domain.DirectConversation;

namespace Stellarr.Api.Tests;

/// <summary>
/// Friend requests, friendships and blocks. Each test runs against an
/// application of its own, since the relationships it builds would otherwise
/// show up in the next test's state.
/// </summary>
public sealed class FriendshipFlowTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private static readonly Dictionary<string, (Guid Id, string Password)> People = new()
    {
        ["maja"] = (Guid.Parse("30000000-0000-0000-0000-000000000001"), "Aurora!2026"),
        ["ada"] = (Guid.Parse("30000000-0000-0000-0000-000000000002"), "Quasar!2026"),
        ["ilya"] = (Guid.Parse("30000000-0000-0000-0000-000000000003"), "Meteor!2026"),
        ["nils"] = (Guid.Parse("30000000-0000-0000-0000-000000000004"), "Zenith!2026"),
        ["jo"] = (Guid.Parse("30000000-0000-0000-0000-000000000005"), "Corona!2026"),
    };

    [Fact]
    public async Task AcceptingARequestMakesBothPeopleFriends()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");

        Assert.Equal("sent", await RequestAsync(maja, "ada"));

        var outgoing = Assert.Single((await StateAsync(maja)).GetProperty("requests").EnumerateArray());
        Assert.Equal("outgoing", outgoing.GetProperty("direction").GetString());
        Assert.Equal("ada", outgoing.GetProperty("user").GetProperty("username").GetString());
        var incoming = Assert.Single((await StateAsync(ada)).GetProperty("requests").EnumerateArray());
        Assert.Equal("incoming", incoming.GetProperty("direction").GetString());
        Assert.Equal("maja", incoming.GetProperty("user").GetProperty("username").GetString());
        var requestId = incoming.GetProperty("id").GetString();

        // Only the person it was sent to may accept it.
        Assert.Equal(HttpStatusCode.NotFound, (await maja.PostAsync($"/api/social/requests/{requestId}/accept", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await ada.PostAsync($"/api/social/requests/{requestId}/accept", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ada.PostAsync($"/api/social/requests/{requestId}/accept", null)).StatusCode);

        foreach (var (client, friend) in new[] { (maja, "ada"), (ada, "maja") })
        {
            var state = await StateAsync(client);
            Assert.Empty(state.GetProperty("requests").EnumerateArray());
            var entry = Assert.Single(state.GetProperty("friends").EnumerateArray());
            Assert.Equal(friend, entry.GetProperty("user").GetProperty("username").GetString());
            Assert.True(entry.GetProperty("since").GetDateTime() > DateTime.UtcNow.AddMinutes(-1));
        }
    }

    [Fact]
    public async Task ARequestIsDeclinedByItsReceiverAndWithdrawnByItsSender()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        using var ilya = await SignInAsync(factory, "ilya");

        await RequestAsync(maja, "ada");
        var requestId = await OnlyRequestIdAsync(ada);

        Assert.Equal(HttpStatusCode.NotFound, (await ilya.DeleteAsync($"/api/social/requests/{requestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await ada.DeleteAsync($"/api/social/requests/{requestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ada.DeleteAsync($"/api/social/requests/{requestId}")).StatusCode);
        Assert.Empty((await StateAsync(maja)).GetProperty("requests").EnumerateArray());
        Assert.Empty((await StateAsync(ada)).GetProperty("friends").EnumerateArray());

        Assert.Equal("sent", await RequestAsync(maja, "ada"));
        requestId = await OnlyRequestIdAsync(maja);
        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/social/requests/{requestId}")).StatusCode);
        Assert.Empty((await StateAsync(ada)).GetProperty("requests").EnumerateArray());
        Assert.Empty((await StateAsync(ada)).GetProperty("friends").EnumerateArray());
    }

    [Fact]
    public async Task EachOutcomeOfARequestHasItsOwnResultCode()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        using var ilya = await SignInAsync(factory, "ilya");

        Assert.Equal("unknown-user", await RequestAsync(maja, "nobody-by-that-name"));
        Assert.Equal("self", await RequestAsync(maja, "@MAJA"));

        Assert.Equal("sent", await RequestAsync(maja, "  @Ada  "));
        Assert.Equal("already-sent", await RequestAsync(maja, "ada"));
        Assert.Equal("already-sent", await RequestAsync(ada, "maja"));

        (await ada.PostAsync($"/api/social/requests/{await OnlyRequestIdAsync(ada)}/accept", null))
            .EnsureSuccessStatusCode();
        Assert.Equal("already-friends", await RequestAsync(maja, "ada"));
        Assert.Equal("already-friends", await RequestAsync(ada, "maja"));

        (await ilya.PostAsync($"/api/social/blocks/{People["maja"].Id}", null)).EnsureSuccessStatusCode();
        Assert.Equal("blocked", await RequestAsync(ilya, "maja"));
        Assert.Equal("blocked", await RequestAsync(maja, "ilya"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("@")]
    public async Task ARequestWithoutAUsernameIsRejected(string username)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");

        var response = await maja.PostAsJsonAsync("/api/social/requests", new { username });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnAccountThatTurnedRequestsOffReadsLikeOneThatDoesNotExist()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        (await ada.PatchAsJsonAsync("/api/me/preferences", new { allowFriendRequests = false }))
            .EnsureSuccessStatusCode();

        Assert.Equal("unknown-user", await RequestAsync(maja, "ada"));

        Assert.Empty((await StateAsync(ada)).GetProperty("requests").EnumerateArray());
        Assert.Empty((await StateAsync(maja)).GetProperty("requests").EnumerateArray());
        // Turning requests off does not stop the account from asking others.
        Assert.Equal("sent", await RequestAsync(ada, "maja"));
    }

    [Fact]
    public async Task RemovingAFriendEndsTheFriendshipForBothPeople()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        await BefriendAsync(maja, ada, "ada");

        Assert.Equal(HttpStatusCode.NotFound, (await maja.DeleteAsync($"/api/social/friends/{People["jo"].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await ada.DeleteAsync($"/api/social/friends/{People["maja"].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await maja.DeleteAsync($"/api/social/friends/{People["ada"].Id}")).StatusCode);

        Assert.Empty((await StateAsync(maja)).GetProperty("friends").EnumerateArray());
        Assert.Empty((await StateAsync(ada)).GetProperty("friends").EnumerateArray());
        Assert.Equal("sent", await RequestAsync(maja, "ada"));
    }

    [Fact]
    public async Task BlockingEndsTheFriendshipAndEveryRequestBetweenTheTwo()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        using var ilya = await SignInAsync(factory, "ilya");
        using var nils = await SignInAsync(factory, "nils");
        await BefriendAsync(maja, ada, "ada");
        await RequestAsync(ilya, "maja");
        await RequestAsync(maja, "nils");

        foreach (var person in new[] { "ada", "ilya", "nils" })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await maja.PostAsync($"/api/social/blocks/{People[person].Id}", null)).StatusCode);
        }

        var state = await StateAsync(maja);
        Assert.Empty(state.GetProperty("friends").EnumerateArray());
        Assert.Empty(state.GetProperty("requests").EnumerateArray());
        Assert.Equal(["ada", "ilya", "nils"], Usernames(state, "blocked").Order());
        foreach (var other in new[] { ada, ilya, nils })
        {
            var theirs = await StateAsync(other);
            Assert.Empty(theirs.GetProperty("friends").EnumerateArray());
            Assert.Empty(theirs.GetProperty("requests").EnumerateArray());
            // Being blocked is not something the other side is shown.
            Assert.Empty(theirs.GetProperty("blocked").EnumerateArray());
        }
    }

    [Fact]
    public async Task BlockingTwiceKeepsOneBlockAndOnlyRealPeopleCanBeBlocked()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");

        Assert.Equal(HttpStatusCode.NoContent, (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await maja.PostAsync($"/api/social/blocks/{People["maja"].Id}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await maja.PostAsync($"/api/social/blocks/{Guid.NewGuid()}", null)).StatusCode);

        Assert.Equal(["ada"], Usernames(await StateAsync(maja), "blocked"));
    }

    [Fact]
    public async Task UnblockingRestoresNothingThatBlockingRemoved()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        await BefriendAsync(maja, ada, "ada");
        await RequestAsync(maja, "ilya");
        (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).EnsureSuccessStatusCode();
        (await maja.PostAsync($"/api/social/blocks/{People["ilya"].Id}", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/social/blocks/{People["ada"].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/social/blocks/{People["ilya"].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await maja.DeleteAsync($"/api/social/blocks/{People["ada"].Id}")).StatusCode);

        var state = await StateAsync(maja);
        Assert.Empty(state.GetProperty("friends").EnumerateArray());
        Assert.Empty(state.GetProperty("requests").EnumerateArray());
        Assert.Empty(state.GetProperty("blocked").EnumerateArray());
        Assert.Equal("sent", await RequestAsync(maja, "ada"));
    }

    [Fact]
    public async Task OnlyTheBlockerCanLiftABlock()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await ada.DeleteAsync($"/api/social/blocks/{People["maja"].Id}")).StatusCode);

        Assert.Equal("blocked", await RequestAsync(ada, "maja"));
    }

    [Fact]
    public async Task TheStateListsFriendsRequestsWithTheirDirectionAndBlockedPeople()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        using var ilya = await SignInAsync(factory, "ilya");
        using var nils = await SignInAsync(factory, "nils");
        await BefriendAsync(maja, ada, "ada");
        await RequestAsync(ilya, "maja");
        await RequestAsync(maja, "nils");
        (await maja.PostAsync($"/api/social/blocks/{People["jo"].Id}", null)).EnsureSuccessStatusCode();

        var state = await StateAsync(maja);

        Assert.Equal(["ada"], Usernames(state, "friends"));
        Assert.Equal(["jo"], Usernames(state, "blocked"));
        Assert.Equal(
            [("ilya", "incoming"), ("nils", "outgoing")],
            state.GetProperty("requests").EnumerateArray()
                .Select(x => (x.GetProperty("user").GetProperty("username").GetString()!, x.GetProperty("direction").GetString()!))
                .Order());
        Assert.Empty(state.GetProperty("conversations").EnumerateArray());
    }

    [Fact]
    public async Task EveryChangeIsPushedToTheTwoPeopleItConcernsOnly()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        await using var adaHub = await ConnectAsync(factory, "ada");
        await using var joHub = await ConnectAsync(factory, "jo");
        using var adaChanges = new Inbox(adaHub, "SocialChanged");
        using var joChanges = new Inbox(joHub, "SocialChanged");

        await RequestAsync(maja, "ada");
        await adaChanges.NextAsync();
        (await ada.PostAsync($"/api/social/requests/{await OnlyRequestIdAsync(ada)}/accept", null))
            .EnsureSuccessStatusCode();
        await adaChanges.NextAsync();
        (await maja.DeleteAsync($"/api/social/friends/{People["ada"].Id}")).EnsureSuccessStatusCode();
        await adaChanges.NextAsync();
        (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).EnsureSuccessStatusCode();
        await adaChanges.NextAsync();
        (await maja.DeleteAsync($"/api/social/blocks/{People["ada"].Id}")).EnsureSuccessStatusCode();
        await adaChanges.NextAsync();

        await Task.Delay(150);
        Assert.Equal(0, joChanges.Received);
    }

    [Fact]
    public async Task BlockingEndsALiveDirectCallAndTellsBothPeople()
    {
        using var factory = new StellarrWebApplicationFactory();
        var conversationId = Guid.NewGuid();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.DirectConversations.Add(new DirectConversation
            {
                Id = conversationId,
                UserAId = People["maja"].Id,
                UserBId = People["ada"].Id,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var room = conversationId.ToString();
        using var maja = await SignInAsync(factory, "maja");
        await using var majaHub = await ConnectAsync(factory, "maja");
        await using var adaHub = await ConnectAsync(factory, "ada");
        await using var joHub = await ConnectAsync(factory, "jo");
        using var majaDeclined = new Inbox(majaHub, "DirectCallDeclined", room);
        using var adaDeclined = new Inbox(adaHub, "DirectCallDeclined", room);
        using var joDeclined = new Inbox(joHub, "DirectCallDeclined", room);
        using var adaOccupancy = new Inbox(adaHub, "VoiceParticipantChanged", room);
        await majaHub.InvokeAsync("JoinVoice", room);
        await adaHub.InvokeAsync("JoinVoice", room);
        var presence = factory.Services.GetRequiredService<PresenceTracker>();
        Assert.Equal(2, presence.VoiceUsers(conversationId).Count);

        (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).EnsureSuccessStatusCode();

        Assert.Equal(People["maja"].Id.ToString(), (await majaDeclined.NextAsync()).GetProperty("byUserId").GetString());
        Assert.Equal(People["maja"].Id.ToString(), (await adaDeclined.NextAsync()).GetProperty("byUserId").GetString());
        JsonElement frame;
        do
        {
            frame = await adaOccupancy.NextAsync();
        }
        while (frame.GetProperty("participants").GetArrayLength() > 0);
        Assert.Empty(presence.VoiceUsers(conversationId));
        await Task.Delay(150);
        Assert.Equal(0, joDeclined.Received);
    }

    private static async Task<HttpClient> SignInAsync(StellarrWebApplicationFactory factory, string username)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password = People[username].Password }))
            .EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<HubConnection> ConnectAsync(StellarrWebApplicationFactory factory, string username)
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new { username, password = People[username].Password });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        await connection.StartAsync();
        return connection;
    }

    private static async Task<string> RequestAsync(HttpClient client, string username)
    {
        var response = await client.PostAsJsonAsync("/api/social/requests", new { username });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetString()!;
    }

    private static async Task BefriendAsync(HttpClient sender, HttpClient receiver, string receiverName)
    {
        Assert.Equal("sent", await RequestAsync(sender, receiverName));
        (await receiver.PostAsync($"/api/social/requests/{await OnlyRequestIdAsync(receiver)}/accept", null))
            .EnsureSuccessStatusCode();
    }

    private static async Task<string> OnlyRequestIdAsync(HttpClient client) =>
        Assert.Single((await StateAsync(client)).GetProperty("requests").EnumerateArray())
            .GetProperty("id").GetString()!;

    private static async Task<JsonElement> StateAsync(HttpClient client) =>
        await client.GetFromJsonAsync<JsonElement>("/api/social");

    /// <summary>The usernames of a list in the state, friends and blocked people alike.</summary>
    private static string[] Usernames(JsonElement state, string list) =>
        [.. state.GetProperty(list).EnumerateArray().Select(x =>
            (x.TryGetProperty("user", out var user) ? user : x).GetProperty("username").GetString()!)];

    /// <summary>The payloads of one server event, optionally only those about one room.</summary>
    private sealed class Inbox : IDisposable
    {
        private readonly Channel<JsonElement> _payloads = Channel.CreateUnbounded<JsonElement>();
        private readonly IDisposable _subscription;
        private int _received;

        public Inbox(HubConnection connection, string method, string? channelId = null)
        {
            _subscription = connection.On<JsonElement>(method, payload =>
            {
                if (channelId is not null && payload.GetProperty("channelId").GetString() != channelId)
                {
                    return;
                }

                Interlocked.Increment(ref _received);
                _payloads.Writer.TryWrite(payload);
            });
        }

        public int Received => Volatile.Read(ref _received);

        public async Task<JsonElement> NextAsync()
        {
            using var timeout = new CancellationTokenSource(Patience);
            return await _payloads.Reader.ReadAsync(timeout.Token);
        }

        public void Dispose() => _subscription.Dispose();
    }
}
