using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class ServerDirectoryFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public ServerDirectoryFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task CreatingAServerSeedsTheStarterChannelsTheRequestNames()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var created = await owner.PostAsJsonAsync("/api/servers", new
        {
            name = "Załoga",
            description = "Wieczorne granie",
            textChannelName = "ogłoszenia",
            voiceChannelName = "salon",
            mentionsOnly = false,
            voiceJoinSound = false,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var payload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var serverId = Guid.Parse(payload.RootElement.GetProperty("id").GetString()!);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var channels = await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.Position)
            .ToListAsync();

        Assert.Collection(
            channels,
            channel =>
            {
                Assert.Equal("ogłoszenia", channel.Name);
                Assert.Equal(ChannelKind.Text, channel.Kind);
            },
            channel =>
            {
                Assert.Equal("salon", channel.Name);
                Assert.Equal(ChannelKind.Voice, channel.Kind);
            });

        var settings = await db.ServerAdminSettings.AsNoTracking()
            .SingleAsync(x => x.ServerId == serverId);
        Assert.False(settings.MentionsOnly);
        Assert.True(settings.AllMessages);
        Assert.False(settings.VoiceJoinSound);
    }

    [Fact]
    public async Task AnEmptyVoiceNameCreatesTheServerWithoutAVoiceChannel()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var created = await owner.PostAsJsonAsync("/api/servers", new
        {
            name = "Tylko tekst",
            voiceChannelName = "",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var payload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var serverId = Guid.Parse(payload.RootElement.GetProperty("id").GetString()!);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var channels = await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId).ToListAsync();

        // The omitted text name still falls back to the seed's own.
        var only = Assert.Single(channels);
        Assert.Equal("ogólny", only.Name);
        Assert.Equal(ChannelKind.Text, only.Kind);
    }

    [Fact]
    public async Task StarterChannelsMustDifferAndBeValidNames()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var clashing = await owner.PostAsJsonAsync("/api/servers", new
        {
            name = "Kolizja",
            textChannelName = "wspólny",
            voiceChannelName = "wspólny",
        });
        Assert.Equal(HttpStatusCode.BadRequest, clashing.StatusCode);

        var invalid = await owner.PostAsJsonAsync("/api/servers", new
        {
            name = "Zły znak",
            textChannelName = "ma spację",
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task CreatingAChannelScopedInviteReturnsAndPersistsTheChannel()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var serverId = await CreateServerAsync(owner, "Kanałowe zaproszenie", "spotkanie");
        var channel = await ChannelAsync(serverId, "spotkanie");
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());

        var created = await owner.PostAsJsonAsync("/api/admin/invites", new
        {
            channelId = channel.Id,
        });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var payload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        Assert.Equal(channel.Id.ToString(), payload.RootElement.GetProperty("channelId").GetString());
        Assert.Equal(channel.Name, payload.RootElement.GetProperty("channelName").GetString());

        var inviteId = Guid.Parse(payload.RootElement.GetProperty("id").GetString()!);
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var invite = await db.ServerInvites.AsNoTracking().SingleAsync(x => x.Id == inviteId);
        Assert.Equal(channel.Id, invite.ChannelId);
        Assert.Contains(
            await db.ServerAuditEntries.Where(x => x.ServerId == serverId).Select(x => x.Summary).ToArrayAsync(),
            summary => summary == $"Maja utworzył(a) zaproszenie na kanał #{channel.Name}");
    }

    [Fact]
    public async Task CreatingAnInviteRejectsAChannelFromAnotherServer()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var activeServerId = await CreateServerAsync(owner, "Serwer aktywny", "aktywny");
        var otherServerId = await CreateServerAsync(owner, "Serwer obcy", "obcy");
        var otherChannel = await ChannelAsync(otherServerId, "obcy");
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", activeServerId.ToString());

        var rejected = await owner.PostAsJsonAsync("/api/admin/invites", new
        {
            channelId = otherChannel.Id,
        });

        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        using var payload = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync());
        Assert.True(payload.RootElement.GetProperty("errors").TryGetProperty("channelId", out _));

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.ServerInvites.AnyAsync(x => x.ServerId == activeServerId));
    }

    [Fact]
    public async Task JoiningThroughAChannelInviteReturnsTheChannel()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var serverId = await CreateServerAsync(owner, "Dołączanie kanałowe", "dołącz-tu");
        var channel = await ChannelAsync(serverId, "dołącz-tu");
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());

        var created = await owner.PostAsJsonAsync("/api/admin/invites", new
        {
            channelId = channel.Id,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var invitePayload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var inviteUrl = invitePayload.RootElement.GetProperty("url").GetString()!;
        var inviteCode = inviteUrl[(inviteUrl.LastIndexOf('/') + 1)..];

        using var invited = Client();
        await LoginAsync(invited, "ada", "Quasar!2026");
        var joined = await invited.PostAsync($"/api/invites/{inviteCode}/join", null);

        Assert.Equal(HttpStatusCode.OK, joined.StatusCode);
        using var joinedPayload = JsonDocument.Parse(await joined.Content.ReadAsStringAsync());
        Assert.Equal(serverId.ToString(), joinedPayload.RootElement.GetProperty("id").GetString());
        Assert.Equal(channel.Id.ToString(), joinedPayload.RootElement.GetProperty("channelId").GetString());
        Assert.Equal(channel.Name, joinedPayload.RootElement.GetProperty("channelName").GetString());

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var invitedUserId = await db.Users.Where(x => x.Username == "ada").Select(x => x.Id).SingleAsync();
        Assert.True(await db.ServerMembers.AnyAsync(
            x => x.ServerId == serverId && x.UserId == invitedUserId));
    }

    [Fact]
    public async Task BodilessCreateStillProducesAServerWideInvite()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var serverId = await CreateServerAsync(owner, "Zaproszenie serwerowe", "rozmowy");
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());

        var created = await owner.PostAsync("/api/admin/invites", null);

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var payload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, payload.RootElement.GetProperty("channelId").ValueKind);
        Assert.Equal(JsonValueKind.Null, payload.RootElement.GetProperty("channelName").ValueKind);

        var inviteId = Guid.Parse(payload.RootElement.GetProperty("id").GetString()!);
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Null(await db.ServerInvites.Where(x => x.Id == inviteId)
            .Select(x => x.ChannelId).SingleAsync());
    }

    [Fact]
    public async Task SendingAnInviteCreatesADurableGlobalNotificationUntilItIsAccepted()
    {
        using var owner = Client();
        using var invited = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(invited, "ada", "Quasar!2026");
        var serverId = await CreateServerAsync(owner, $"Trwałe {Guid.NewGuid():N}", "wejście");
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());

        var created = await owner.PostAsync("/api/admin/invites", null);
        created.EnsureSuccessStatusCode();
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var inviteId = createdJson.RootElement.GetProperty("id").GetString()!;
        var inviteUrl = createdJson.RootElement.GetProperty("url").GetString()!;
        var inviteCode = inviteUrl[(inviteUrl.LastIndexOf('/') + 1)..];

        Guid invitedUserId;
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            invitedUserId = await db.Users.Where(x => x.Username == "ada")
                .Select(x => x.Id).SingleAsync();
        }

        var sent = await owner.PostAsync(
            $"/api/admin/invites/{inviteId}/members/{invitedUserId}", null);
        Assert.Equal(HttpStatusCode.NoContent, sent.StatusCode);

        var inbox = await invited.GetFromJsonAsync<JsonElement>("/api/notifications");
        var notification = Assert.Single(inbox.GetProperty("items").EnumerateArray(), item =>
            item.GetProperty("target").ValueKind != JsonValueKind.Null &&
            item.GetProperty("target").GetProperty("type").GetString() == "server-invite" &&
            item.GetProperty("target").GetProperty("serverId").GetString() == serverId.ToString());
        Assert.Equal(inviteCode,
            notification.GetProperty("target").GetProperty("inviteCode").GetString());

        var joined = await invited.PostAsync($"/api/invites/{inviteCode}/join", null);
        joined.EnsureSuccessStatusCode();
        var afterJoin = await invited.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.DoesNotContain(afterJoin.GetProperty("items").EnumerateArray(), item =>
            item.GetProperty("id").GetString() == notification.GetProperty("id").GetString());
    }

    [Fact]
    public async Task RegistrationWithoutInviteCannotJoinAPrivateInstance()
    {
        var username = ($"no-invite-{Guid.NewGuid():N}")[..30];
        using var client = Client();

        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            username,
            displayName = "No Invite",
            email = $"{username}@example.test",
            password = "Invitation!2026",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Users.AnyAsync(x => x.Username == username));
    }

    [Fact]
    public async Task RegistrationInviteCreatesTheAccountOnTheInvitedServer()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var created = await owner.PostAsJsonAsync("/api/servers", new
        {
            name = $"Zaproszony {Guid.NewGuid():N}",
            description = "Serwer docelowy zaproszenia",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdPayload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var serverId = Guid.Parse(createdPayload.RootElement.GetProperty("id").GetString()!);
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());

        var createdInvite = await owner.PostAsync("/api/admin/invites", null);
        Assert.Equal(HttpStatusCode.Created, createdInvite.StatusCode);
        using var invitePayload = JsonDocument.Parse(await createdInvite.Content.ReadAsStringAsync());
        var inviteUrl = invitePayload.RootElement.GetProperty("url").GetString()!;
        var inviteCode = inviteUrl[(inviteUrl.LastIndexOf('/') + 1)..];
        var inviteId = Guid.Parse(invitePayload.RootElement.GetProperty("id").GetString()!);

        var username = ($"invite-{Guid.NewGuid():N}")[..30];
        using var invited = Client();
        var registration = await invited.PostAsJsonAsync("/api/auth/register", new
        {
            username,
            displayName = "Invited Person",
            email = $"{username}@example.test",
            password = "Invitation!2026",
            inviteCode,
        });
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = await db.Users.Where(x => x.Username == username)
            .Select(x => x.Id).SingleAsync();
        var membership = await db.ServerMembers.Include(x => x.Role)
            .SingleAsync(x => x.UserId == userId);
        Assert.Equal(serverId, membership.ServerId);
        Assert.False(membership.Role.IsOwner);
        Assert.Equal(1, await db.ServerInvites.Where(x => x.Id == inviteId)
            .Select(x => x.Uses).SingleAsync());
        var welcome = await db.Messages.AsNoTracking()
            .Include(x => x.Author)
            .SingleAsync(x => x.AuthorId == userId && x.IsSystem);
        Assert.Equal("<b>Invited Person</b> dołącza do serwera. Przywitajcie się!", welcome.Content);
        Assert.Equal(
            "ogólny",
            await db.Channels.Where(x => x.Id == welcome.ChannelId)
                .Select(x => x.Name)
                .SingleAsync());
    }

    [Fact]
    public async Task InvalidRegistrationInviteDoesNotCreateAnAccount()
    {
        var username = ($"rejected-{Guid.NewGuid():N}")[..30];
        using var invited = Client();
        var registration = await invited.PostAsJsonAsync("/api/auth/register", new
        {
            username,
            displayName = "Rejected Person",
            email = $"{username}@example.test",
            password = "Invitation!2026",
            inviteCode = "not-a-real-invite",
        });
        Assert.Equal(HttpStatusCode.BadRequest, registration.StatusCode);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Users.AnyAsync(x => x.Username == username));
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task<Guid> CreateServerAsync(
        HttpClient owner,
        string name,
        string voiceChannelName)
    {
        var response = await owner.PostAsJsonAsync("/api/servers", new
        {
            name = $"{name} {Guid.NewGuid():N}",
            voiceChannelName,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return Guid.Parse(payload.RootElement.GetProperty("id").GetString()!);
    }

    private async Task<(Guid Id, string Name)> ChannelAsync(Guid serverId, string name)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var channel = await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId && x.Name == name)
            .Select(x => new { x.Id, x.Name })
            .SingleAsync();
        return (channel.Id, channel.Name);
    }

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
}
