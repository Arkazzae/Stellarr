using Microsoft.AspNetCore.SignalR.Client;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// Direct calls: voice rooms whose id is a direct conversation. The
/// conversations are written straight to the database, since the endpoints
/// that open them belong to the social features.
/// </summary>
public sealed partial class VoiceRoomTests
{
    private static readonly Guid MajaAndAda = Guid.Parse("50000000-0000-0000-0000-0000000000a1");

    [Fact]
    public async Task ADirectRoomOnlyTakesItsTwoOwnersAndOnlyTellsThem()
    {
        await using var app = new VoiceApp();
        app.Seed(db => db.DirectConversations.Add(Conversation("maja", "ada")));
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var stranger = await app.ConnectAsync("jo");
        var room = MajaAndAda.ToString();

        await RefusedAsync("Unknown voice room.", stranger.JoinAsync(room));
        await maja.JoinAsync(room);

        Assert.Equal([maja.Id.ToString()], Occupants(await ada["VoiceParticipantChanged"].NextAsync(InRoom(room))));
        await ada.JoinAsync(room);
        await maja.SignalAsync(room, "state", "{}", toUserId: ada.Id.ToString());
        Assert.Equal(maja.Id.ToString(), (await ada["VoiceSignal"].NextAsync()).GetProperty("fromUserId").GetString());
        await stranger.SettleAsync();
        Assert.Empty(stranger["VoiceParticipantChanged"].Drain());
        await RefusedAsync("Invalid voice signal.", stranger.SignalAsync(room, "state", "{}"));
    }

    [Theory]
    [InlineData("maja", "ada")]
    [InlineData("ada", "maja")]
    public async Task ACallIsRefusedToBothPeopleWhenEitherBlockedTheOther(string blocker, string blocked)
    {
        await using var app = new VoiceApp();
        app.Seed(db =>
        {
            db.DirectConversations.Add(Conversation("maja", "ada"));
            db.UserBlocks.Add(new UserBlock
            {
                BlockerId = Accounts[blocker].Id,
                BlockedId = Accounts[blocked].Id,
                CreatedAt = DateTime.UtcNow,
            });
        });
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");

        await RefusedAsync("Unknown voice room.", maja.JoinAsync(MajaAndAda.ToString()));
        await RefusedAsync("Unknown voice room.", ada.JoinAsync(MajaAndAda.ToString()));
    }

    [Fact]
    public async Task ACallToSomebodyWhoTakesNoDirectMessagesNeedsAFriendship()
    {
        await using var app = new VoiceApp();
        app.Seed(db =>
        {
            db.DirectConversations.Add(Conversation("maja", "ada"));
            db.UserPreferences.Add(new UserPreferenceSettings { UserId = Accounts["ada"].Id, AllowDirectMessages = false });
        });
        var maja = await app.ConnectAsync("maja");
        var room = MajaAndAda.ToString();

        await RefusedAsync("Unknown voice room.", maja.JoinAsync(room));

        app.Seed(db => db.Friendships.Add(new Friendship
        {
            Id = Guid.NewGuid(),
            UserAId = Accounts["maja"].Id,
            UserBId = Accounts["ada"].Id,
            CreatedAt = DateTime.UtcNow,
        }));
        await maja.JoinAsync(room);
        Assert.Equal([maja.Id], app.Presence.VoiceUsers(MajaAndAda).Select(x => x.UserId));
    }

    [Fact]
    public async Task ACallThatIsAlreadyRingingCanBeAnsweredWhateverTheCallerTakes()
    {
        await using var app = new VoiceApp();
        app.Seed(db =>
        {
            db.DirectConversations.Add(Conversation("maja", "ada"));
            db.UserPreferences.Add(new UserPreferenceSettings { UserId = Accounts["maja"].Id, AllowDirectMessages = false });
        });
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var room = MajaAndAda.ToString();

        await RefusedAsync("Unknown voice room.", ada.JoinAsync(room));
        await maja.JoinAsync(room);
        await ada.JoinAsync(room);

        Assert.Equal(2, app.Presence.VoiceUsers(MajaAndAda).Count);
    }

    [Fact]
    public async Task DecliningACallEndsItForBothPeople()
    {
        await using var app = new VoiceApp();
        app.Seed(db => db.DirectConversations.Add(Conversation("maja", "ada")));
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var stranger = await app.ConnectAsync("jo");
        var room = MajaAndAda.ToString();
        await maja.JoinAsync(room);
        await ada.JoinAsync(room);

        await RefusedAsync("Unknown direct call.", stranger.Connection.InvokeAsync("DeclineDirectCall", room));
        await ada.Connection.InvokeAsync("DeclineDirectCall", room);

        foreach (var peer in new[] { maja, ada })
        {
            var declined = await peer["DirectCallDeclined"].NextAsync();
            Assert.Equal(room, declined.GetProperty("channelId").GetString());
            Assert.Equal(ada.Id.ToString(), declined.GetProperty("byUserId").GetString());
            var emptied = await peer["VoiceParticipantChanged"].NextAsync(x => InRoom(room)(x) && Occupants(x).Length == 0);
            Assert.Empty(Occupants(emptied));
        }
        Assert.Empty(app.Presence.VoiceUsers(MajaAndAda));
    }

    [Fact]
    public async Task ACallCanStillBeDeclinedAfterOneSideBlockedTheOther()
    {
        await using var app = new VoiceApp();
        app.Seed(db => db.DirectConversations.Add(Conversation("maja", "ada")));
        var maja = await app.ConnectAsync("maja");
        var ada = await app.ConnectAsync("ada");
        var room = MajaAndAda.ToString();
        await maja.JoinAsync(room);
        app.Seed(db => db.UserBlocks.Add(new UserBlock
        {
            BlockerId = Accounts["maja"].Id,
            BlockedId = Accounts["ada"].Id,
            CreatedAt = DateTime.UtcNow,
        }));

        await ada.Connection.InvokeAsync("DeclineDirectCall", room);

        Assert.Equal(room, (await maja["DirectCallDeclined"].NextAsync()).GetProperty("channelId").GetString());
        Assert.Empty(app.Presence.VoiceUsers(MajaAndAda));
    }

    [Fact]
    public async Task ADeviceThatConnectsDuringACallIsToldWhoIsInIt()
    {
        await using var app = new VoiceApp();
        app.Seed(db => db.DirectConversations.Add(Conversation("maja", "ada")));
        var maja = await app.ConnectAsync("maja");
        var room = MajaAndAda.ToString();
        await maja.JoinAsync(room);

        var ada = await app.ConnectAsync("ada");

        var restored = await ada["VoiceParticipantChanged"].NextAsync(InRoom(room));
        Assert.Equal([maja.Id.ToString()], Occupants(restored));
    }

    private static DirectConversation Conversation(string firstUser, string secondUser) => new()
    {
        Id = MajaAndAda,
        UserAId = Accounts[firstUser].Id,
        UserBId = Accounts[secondUser].Id,
        CreatedAt = DateTime.UtcNow,
    };
}
