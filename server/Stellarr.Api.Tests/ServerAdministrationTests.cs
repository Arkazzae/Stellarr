using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// The administration of a server. Every test works on a server of its own, so
/// that transferring or deleting one cannot disturb the others.
/// </summary>
public sealed class ServerAdministrationTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid NilsId = Guid.Parse("30000000-0000-0000-0000-000000000004");
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");

    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private readonly StellarrWebApplicationFactory _factory;

    public ServerAdministrationTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task TransferMakesTheTargetTheOnlyOwnerAndDemotesTheCaller()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);

        var response = await maja.PostAsJsonAsync("/api/admin/server/transfer", new { userId = AdaId });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = await db.ServerMembers.AsNoTracking().Include(x => x.Role)
            .Where(x => x.ServerId == server.Id).ToListAsync();
        var successor = members.Single(x => x.UserId == AdaId);
        Assert.Equal(1, successor.OwnerSlot);
        Assert.True(successor.Role.IsOwner);
        var former = members.Single(x => x.UserId == MajaId);
        Assert.Null(former.OwnerSlot);
        Assert.True(former.Role.IsSystem);
        Assert.False(former.Role.IsOwner);
        Assert.Single(members, x => x.OwnerSlot == 1);
        Assert.Contains(
            await db.ServerAuditEntries.Where(x => x.ServerId == server.Id).Select(x => x.Summary).ToArrayAsync(),
            summary => summary == "Maja przekazał(a) własność serwera");

        Assert.Equal(HttpStatusCode.Forbidden, (await maja.DeleteAsync("/api/admin/server")).StatusCode);
    }

    [Fact]
    public async Task OnlyTheOwnerMayTransferTheServer()
    {
        var server = await SeedServerAsync();
        using var ada = await SignInAsync("ada", "Quasar!2026", server);

        var response = await ada.PostAsJsonAsync("/api/admin/server/transfer", new { userId = AdaId });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(
            MajaId,
            await db.ServerMembers.Where(x => x.ServerId == server.Id && x.OwnerSlot == 1)
                .Select(x => x.UserId).SingleAsync());
    }

    [Theory]
    [InlineData("maja")]
    [InlineData("nils")]
    public async Task TransferToOneselfOrToANonMemberIsAValidationError(string target)
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        var userId = target == "maja" ? MajaId : NilsId;

        var response = await maja.PostAsJsonAsync("/api/admin/server/transfer", new { userId });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("userId", out _));
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(
            MajaId,
            await db.ServerMembers.Where(x => x.ServerId == server.Id && x.OwnerSlot == 1)
                .Select(x => x.UserId).SingleAsync());
    }

    [Fact]
    public async Task OnlyTheOwnerMayDeleteTheServerAndItGoesWithItsMembers()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        using var ada = await SignInAsync("ada", "Quasar!2026", server);
        var invite = await CreateInviteAsync(maja);
        (await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{NilsId}", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Forbidden, (await ada.DeleteAsync("/api/admin/server")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync("/api/admin/server")).StatusCode);

        await using var verification = _factory.Services.CreateAsyncScope();
        var context = verification.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await context.Servers.AnyAsync(x => x.Id == server.Id));
        Assert.False(await context.ServerMembers.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await context.ServerRoles.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await context.ServerAdminSettings.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await context.ServerInvites.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await context.ServerAuditEntries.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await context.UserNotifications.AnyAsync(x => x.ServerId == server.Id));
        Assert.True(await context.Users.AnyAsync(x => x.Id == AdaId));
    }

    [Fact]
    public async Task RegisteringWithARevokedInviteIsAValidationError()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        var invite = await CreateInviteAsync(maja);
        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/admin/invites/{invite.Id}")).StatusCode);

        var username = $"revoked-{Guid.NewGuid():N}"[..30];
        using var visitor = _factory.CreateClient();
        var response = await visitor.PostAsJsonAsync("/api/auth/register", new
        {
            username,
            displayName = "Late Guest",
            email = $"{username}@example.test",
            password = "Invitation!2026",
            inviteCode = invite.Code,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("inviteCode", out _));
    }

    [Fact]
    public async Task InvitesAreListedUntilRevokedAndOnlyForThoseWhoManageTheServer()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        using var ada = await SignInAsync("ada", "Quasar!2026", server);

        Assert.Equal(HttpStatusCode.Forbidden, (await ada.GetAsync("/api/admin/invites")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ada.PostAsync("/api/admin/invites", null)).StatusCode);
        var invite = await CreateInviteAsync(maja);
        Assert.StartsWith("http", invite.Url, StringComparison.Ordinal);
        Assert.EndsWith($"/invite/{invite.Code}", invite.Url, StringComparison.Ordinal);

        var listed = await maja.GetFromJsonAsync<JsonElement[]>("/api/admin/invites");
        Assert.Contains(listed!, x => x.GetProperty("id").GetString() == invite.Id.ToString());

        Assert.Equal(HttpStatusCode.NotFound, (await maja.DeleteAsync($"/api/admin/invites/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/admin/invites/{invite.Id}")).StatusCode);
        listed = await maja.GetFromJsonAsync<JsonElement[]>("/api/admin/invites");
        Assert.DoesNotContain(listed!, x => x.GetProperty("id").GetString() == invite.Id.ToString());
    }

    [Fact]
    public async Task SendingAnInviteIsRefusedForMembersBannedAndUnknownPeople()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        var invite = await CreateInviteAsync(maja);
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ServerBans.Add(new ServerBan
            {
                ServerId = server.Id,
                UserId = NilsId,
                BannedById = MajaId,
                Reason = "test",
                BannedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var member = await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{AdaId}", null);
        Assert.Equal(HttpStatusCode.Conflict, member.StatusCode);
        Assert.Equal("already_member", (await member.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{NilsId}", null)).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{Guid.NewGuid()}", null)).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await maja.PostAsync($"/api/admin/invites/{Guid.NewGuid()}/members/{JoId}", null)).StatusCode);
    }

    [Fact]
    public async Task ASentInviteIsDeliveredOnceAndWithdrawnWhenTheInviteIsRevoked()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        using var nils = await SignInAsync("nils", "Zenith!2026", server: null);
        var invite = await CreateInviteAsync(maja);

        var first = await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{NilsId}", null);
        var again = await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{NilsId}", null);
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);

        var delivered = Invitations(await nils.GetFromJsonAsync<JsonElement>("/api/notifications"), server.Id);
        var notification = Assert.Single(delivered);
        Assert.Equal(invite.Code, notification.GetProperty("target").GetProperty("inviteCode").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/admin/invites/{invite.Id}")).StatusCode);
        Assert.Empty(Invitations(await nils.GetFromJsonAsync<JsonElement>("/api/notifications"), server.Id));
    }

    [Fact]
    public async Task RevokingASentInviteTellsTheRecipientToReloadTheInboxWithoutASequence()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        var invite = await CreateInviteAsync(maja);
        await using var nils = await ListenAsync("nils", "Zenith!2026", NilsId);

        Assert.Equal(
            HttpStatusCode.NoContent,
            (await maja.PostAsync($"/api/admin/invites/{invite.Id}/members/{NilsId}", null)).StatusCode);
        var sent = await nils.NextAsync();
        Assert.True(sent.TryGetProperty("sequence", out var sequence));
        Assert.Equal(JsonValueKind.Number, sequence.ValueKind);

        Assert.Equal(HttpStatusCode.NoContent, (await maja.DeleteAsync($"/api/admin/invites/{invite.Id}")).StatusCode);
        var revoked = await nils.NextAsync();
        Assert.Equal(server.Id.ToString(), revoked.GetProperty("serverId").GetString());
        Assert.True(revoked.GetProperty("global").GetBoolean());
        Assert.False(revoked.TryGetProperty("sequence", out _));
    }

    [Fact]
    public async Task TheAuditLogIsRefusedWithoutViewAuditLog()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        using var ada = await SignInAsync("ada", "Quasar!2026", server);
        using var jo = await SignInAsync("jo", "Corona!2026", server);
        await CreateInviteAsync(maja);

        Assert.Equal(HttpStatusCode.Forbidden, (await ada.GetAsync("/api/admin/audit")).StatusCode);

        foreach (var reader in new[] { maja, jo })
        {
            var entries = await reader.GetFromJsonAsync<JsonElement[]>("/api/admin/audit");
            Assert.Contains(entries!, x => x.GetProperty("summary").GetString() == "Maja utworzył(a) zaproszenie");
        }

        // Reading the log does not let its reader manage the server.
        Assert.Equal(HttpStatusCode.Forbidden, (await jo.GetAsync("/api/admin/invites")).StatusCode);
    }

    [Fact]
    public async Task NotificationSettingsRoundTripAndRejectChannelsOfOtherServers()
    {
        var server = await SeedServerAsync();
        using var maja = await SignInAsync("maja", "Aurora!2026", server);
        using var ada = await SignInAsync("ada", "Quasar!2026", server);

        Assert.Equal(HttpStatusCode.Forbidden, (await ada.GetAsync("/api/admin/notifications")).StatusCode);
        var initial = await maja.GetFromJsonAsync<JsonElement>("/api/admin/notifications");
        Assert.False(initial.GetProperty("allMessages").GetBoolean());
        Assert.True(initial.GetProperty("mentionsOnly").GetBoolean());
        Assert.Equal(0, initial.GetProperty("mutedChannelIds").GetArrayLength());

        var updated = await maja.PatchAsJsonAsync("/api/admin/notifications", new
        {
            allMessages = true,
            mentionsOnly = false,
            serverMuted = true,
            mutedChannelIds = new[] { server.ChannelId, server.ChannelId },
        });
        updated.EnsureSuccessStatusCode();

        var read = await maja.GetFromJsonAsync<JsonElement>("/api/admin/notifications");
        Assert.True(read.GetProperty("allMessages").GetBoolean());
        Assert.False(read.GetProperty("mentionsOnly").GetBoolean());
        Assert.True(read.GetProperty("voiceJoinSound").GetBoolean());
        Assert.True(read.GetProperty("serverMuted").GetBoolean());
        var muted = Assert.Single(read.GetProperty("mutedChannelIds").EnumerateArray());
        Assert.Equal(server.ChannelId.ToString(), muted.GetString());

        var foreign = await maja.PatchAsJsonAsync("/api/admin/notifications", new
        {
            mutedChannelIds = new[] { TestData.GeneralChannelId },
        });
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        read = await maja.GetFromJsonAsync<JsonElement>("/api/admin/notifications");
        Assert.Equal(1, read.GetProperty("mutedChannelIds").GetArrayLength());
    }

    [Fact]
    public async Task ACreatedServerBelongsToItsCreatorWhoOwnsItAndNameRulesApply()
    {
        using var jo = await SignInAsync("jo", "Corona!2026", server: null);

        var tooLong = await jo.PostAsJsonAsync("/api/servers", new { name = "x", description = new string('d', 281) });
        var nameless = await jo.PostAsJsonAsync("/api/servers", new { name = "   " });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, nameless.StatusCode);

        var serverId = await CreateServerAsync(jo, isPublic: false);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var member = await db.ServerMembers.AsNoTracking().Include(x => x.Role).SingleAsync(x => x.ServerId == serverId);
        Assert.Equal(JoId, member.UserId);
        Assert.Equal(1, member.OwnerSlot);
        Assert.True(member.Role.IsOwner);
        var roles = await db.ServerRoles.AsNoTracking().Where(x => x.ServerId == serverId).ToListAsync();
        Assert.Equal(2, roles.Count);
        Assert.All(roles, role => Assert.True(role.IsSystem));
        Assert.True(await db.ServerAdminSettings.AnyAsync(x => x.ServerId == serverId));
    }

    [Fact]
    public async Task TheServerListHoldsOnlyTheServersOfThePersonAskingInOrderOfJoining()
    {
        using var ada = await SignInAsync("ada", "Quasar!2026", server: null);
        using var ilya = await SignInAsync("ilya", "Meteor!2026", server: null);
        var created = await CreateServerAsync(ada, isPublic: false);

        var adaServers = await ada.GetFromJsonAsync<JsonElement[]>("/api/servers");
        var ilyaServers = await ilya.GetFromJsonAsync<JsonElement[]>("/api/servers");

        Assert.Equal(created.ToString(), adaServers![^1].GetProperty("id").GetString());
        Assert.Contains(adaServers, x => x.GetProperty("id").GetString() == TestData.ServerId.ToString());
        Assert.DoesNotContain(ilyaServers!, x => x.GetProperty("id").GetString() == created.ToString());
    }

    [Fact]
    public async Task DiscoveryOffersPublicServersUntilThePersonJoinsOrIsBanned()
    {
        using var ada = await SignInAsync("ada", "Quasar!2026", server: null);
        using var ilya = await SignInAsync("ilya", "Meteor!2026", server: null);
        using var nils = await SignInAsync("nils", "Zenith!2026", server: null);
        var open = await CreateServerAsync(ada, isPublic: true);
        var closed = await CreateServerAsync(ada, isPublic: false);
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ServerBans.Add(new ServerBan
            {
                ServerId = open,
                UserId = NilsId,
                BannedById = AdaId,
                Reason = "test",
                BannedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        Assert.Contains(await DiscoveredAsync(ilya), id => id == open);
        Assert.DoesNotContain(await DiscoveredAsync(ilya), id => id == closed);
        Assert.DoesNotContain(await DiscoveredAsync(ada), id => id == open);
        Assert.DoesNotContain(await DiscoveredAsync(nils), id => id == open);

        Assert.Equal(HttpStatusCode.NotFound, (await ilya.PostAsync($"/api/servers/{closed}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nils.PostAsync($"/api/servers/{open}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ilya.PostAsync($"/api/servers/{open}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ilya.PostAsync($"/api/servers/{open}/join", null)).StatusCode);
        Assert.DoesNotContain(await DiscoveredAsync(ilya), id => id == open);

        await using var verification = _factory.Services.CreateAsyncScope();
        var context = verification.ServiceProvider.GetRequiredService<AppDbContext>();
        var memberRoles = await context.ServerMembers.AsNoTracking().Include(x => x.Role)
            .Where(x => x.ServerId == open && x.UserId != AdaId).ToListAsync();
        var joined = Assert.Single(memberRoles);
        Assert.False(joined.Role.IsOwner);
        Assert.Null(joined.OwnerSlot);
        Assert.Equal(1, await context.Messages.CountAsync(x => x.IsSystem && x.AuthorId == joined.UserId &&
            context.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == open)));
    }

    [Fact]
    public async Task AnInviteCountsEachNewMemberOnceAndRefusesBannedExpiredAndUsedUpCodes()
    {
        using var ada = await SignInAsync("ada", "Quasar!2026", server: null);
        using var ilya = await SignInAsync("ilya", "Meteor!2026", server: null);
        using var nils = await SignInAsync("nils", "Zenith!2026", server: null);
        var serverId = await CreateServerAsync(ada, isPublic: false);
        ada.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());
        var counted = await CreateInviteAsync(ada);
        var expired = await CreateInviteAsync(ada);
        var spent = await CreateInviteAsync(ada);
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.ServerInvites.SingleAsync(x => x.Id == expired.Id)).ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            var used = await db.ServerInvites.SingleAsync(x => x.Id == spent.Id);
            used.Uses = used.MaxUses!.Value;
            db.ServerBans.Add(new ServerBan
            {
                ServerId = serverId,
                UserId = NilsId,
                BannedById = AdaId,
                Reason = "test",
                BannedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.OK, (await ilya.PostAsync($"/api/invites/{counted.Code}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ilya.PostAsync($"/api/invites/{counted.Code}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ilya.PostAsync($"/api/invites/{expired.Code}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ilya.PostAsync($"/api/invites/{spent.Code}/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ilya.PostAsync("/api/invites/no-such-code/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nils.PostAsync($"/api/invites/{counted.Code}/join", null)).StatusCode);

        await using var verification = _factory.Services.CreateAsyncScope();
        var context = verification.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, (await context.ServerInvites.SingleAsync(x => x.Id == counted.Id)).Uses);
        Assert.False(await context.ServerMembers.AnyAsync(x => x.ServerId == serverId && x.UserId == NilsId));
    }

    [Fact]
    public async Task JoiningAServerTellsTheInboxToReloadWithoutASequence()
    {
        using var ada = await SignInAsync("ada", "Quasar!2026", server: null);
        using var jo = await SignInAsync("jo", "Corona!2026", server: null);
        var serverId = await CreateServerAsync(ada, isPublic: false);
        ada.DefaultRequestHeaders.Add("X-Stellarr-Server", serverId.ToString());
        var invite = await CreateInviteAsync(ada);
        await using var listener = await ListenAsync("jo", "Corona!2026", JoId);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await ada.PostAsync($"/api/admin/invites/{invite.Id}/members/{JoId}", null)).StatusCode);
        await listener.NextAsync();

        Assert.Equal(HttpStatusCode.OK, (await jo.PostAsync($"/api/invites/{invite.Code}/join", null)).StatusCode);

        var joined = await listener.NextAsync();
        Assert.Equal(serverId.ToString(), joined.GetProperty("serverId").GetString());
        Assert.True(joined.GetProperty("global").GetBoolean());
        Assert.False(joined.TryGetProperty("sequence", out _));
        Assert.Empty(Invitations(await jo.GetFromJsonAsync<JsonElement>("/api/notifications"), serverId));
    }

    private static async Task<Guid> CreateServerAsync(HttpClient client, bool isPublic)
    {
        var response = await client.PostAsJsonAsync("/api/servers", new { name = $"Directory {Guid.NewGuid():N}", isPublic });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(created.GetProperty("id").GetString()!);
    }

    private static async Task<Guid[]> DiscoveredAsync(HttpClient client)
    {
        var servers = await client.GetFromJsonAsync<JsonElement[]>("/api/servers/discover");
        return servers!.Select(x => Guid.Parse(x.GetProperty("id").GetString()!)).ToArray();
    }

    private static JsonElement[] Invitations(JsonElement inbox, Guid serverId) =>
        inbox.GetProperty("items").EnumerateArray()
            .Where(item => item.GetProperty("target").ValueKind != JsonValueKind.Null &&
                item.GetProperty("target").GetProperty("type").GetString() == "server-invite" &&
                item.GetProperty("target").GetProperty("serverId").GetString() == serverId.ToString())
            .ToArray();

    /// <summary>A started hub connection of the person that records what they hear as NotificationInboxChanged.</summary>
    private async Task<InboxListener> ListenAsync(string username, string password, Guid userId)
    {
        using var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
            })
            .Build();
        var listener = new InboxListener(connection);
        // The hub's first word to a connection comes after it has joined its groups.
        var joined = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = connection.On<JsonElement>("PresenceChanged", payload =>
        {
            if (payload.GetProperty("userId").GetString() == userId.ToString())
            {
                joined.TrySetResult();
            }
        });
        await connection.StartAsync();
        await joined.Task.WaitAsync(Patience);
        return listener;
    }

    private async Task<HttpClient> SignInAsync(string username, string password, SeededServer? server)
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        if (server is not null)
        {
            client.DefaultRequestHeaders.Add("X-Stellarr-Server", server.Id.ToString());
        }

        return client;
    }

    private static async Task<(Guid Id, string Url, string Code)> CreateInviteAsync(HttpClient client)
    {
        var response = await client.PostAsync("/api/admin/invites", null);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var invite = await response.Content.ReadFromJsonAsync<JsonElement>();
        var url = invite.GetProperty("url").GetString()!;
        return (Guid.Parse(invite.GetProperty("id").GetString()!), url, url[(url.LastIndexOf('/') + 1)..]);
    }

    /// <summary>
    /// A server of its own: Maja owns it, Ada is a plain member, Jo may read
    /// the audit log and nothing else, and Nils is not a member.
    /// </summary>
    private async Task<SeededServer> SeedServerAsync()
    {
        var serverId = Guid.NewGuid();
        var ownerRole = new ServerRole
        {
            Id = Guid.NewGuid(), ServerId = serverId, Name = "Właściciel", Color = "#d65775",
            Permissions = ServerPrivileges.All, Position = 0, IsSystem = true, IsOwner = true,
        };
        var memberRole = new ServerRole
        {
            Id = Guid.NewGuid(), ServerId = serverId, Name = "Członek", Color = "#777777",
            Permissions = ServerPrivileges.None, Position = 2, IsSystem = true,
        };
        var auditorRole = new ServerRole
        {
            Id = Guid.NewGuid(), ServerId = serverId, Name = "Audyt", Color = "#62ad78",
            Permissions = ServerPrivileges.ViewAuditLog, Position = 1,
        };
        var channelId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Servers.Add(new StellarrServer { Id = serverId, Name = $"Administration {serverId:N}", CreatedAt = now });
        db.ServerRoles.AddRange(ownerRole, auditorRole, memberRole);
        db.Channels.Add(new Channel
        {
            Id = channelId, ServerId = serverId, Name = "ogólny", Kind = ChannelKind.Text, Position = 0,
        });
        db.ServerAdminSettings.Add(new ServerAdminSettings { ServerId = serverId });
        db.ServerMembers.AddRange(
            new ServerMember { ServerId = serverId, UserId = MajaId, RoleId = ownerRole.Id, OwnerSlot = 1, JoinedAt = now },
            new ServerMember { ServerId = serverId, UserId = AdaId, RoleId = memberRole.Id, JoinedAt = now },
            new ServerMember { ServerId = serverId, UserId = JoId, RoleId = auditorRole.Id, JoinedAt = now });
        await db.SaveChangesAsync();
        return new SeededServer(serverId, channelId);
    }

    private sealed record SeededServer(Guid Id, Guid ChannelId);

    private sealed class InboxListener : IAsyncDisposable
    {
        private readonly HubConnection _connection;
        private readonly System.Threading.Channels.Channel<JsonElement> _events =
            System.Threading.Channels.Channel.CreateUnbounded<JsonElement>();

        public InboxListener(HubConnection connection)
        {
            _connection = connection;
            connection.On<JsonElement>("NotificationInboxChanged", payload => _events.Writer.TryWrite(payload));
        }

        public async Task<JsonElement> NextAsync() =>
            await _events.Reader.ReadAsync().AsTask().WaitAsync(Patience);

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }
}
