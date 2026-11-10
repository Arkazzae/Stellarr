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
/// The rules of channel administration that the flow tests leave alone: the
/// shape of an order, the names, the ranges, the last channel of a kind, and
/// what a role may carry and who may hand it to whom.
/// </summary>
public sealed class ChannelAdministrationTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");
    private static readonly Guid OwnerRoleId = Guid.Parse("60000000-0000-0000-0000-000000000001");
    private static readonly Guid ModeratorRoleId = Guid.Parse("60000000-0000-0000-0000-000000000002");
    private static readonly Guid MemberRoleId = Guid.Parse("60000000-0000-0000-0000-000000000003");

    private static readonly string[] ManageMessages = ["manageMessages"];
    private static readonly string[] ManageMembersAndMessages = ["manageMembers", "manageMessages"];
    private static readonly string[] None = [];
    private static readonly string[] MemberNames = ["Ada", "Ilya", "Jo", "Maja", "Nils"];

    private readonly StellarrWebApplicationFactory _factory;

    public ChannelAdministrationTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task AnOrderMustNameEveryChannelOfTheServerExactlyOnce()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var ids = await ChannelIdsAsync(owner);

        Assert.Equal(HttpStatusCode.BadRequest, (await ReorderAsync(owner, ids.Skip(1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ReorderAsync(owner, ids.Append(ids[0]))).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await ReorderAsync(owner, ids.Skip(1).Append(Guid.NewGuid()))).StatusCode);

        // Nothing of a refused order is kept.
        Assert.Equal(ids, await ChannelIdsAsync(owner));
    }

    [Fact]
    public async Task OnlyAChannelManagerMayReorderAndAFullOrderIsApplied()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        using var moderator = await SignedInAsync(_factory, "ada", "Quasar!2026");
        var ids = await ChannelIdsAsync(owner);
        var reversed = ids.AsEnumerable().Reverse().ToArray();

        Assert.Equal(HttpStatusCode.Forbidden, (await ReorderAsync(moderator, reversed)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await ReorderAsync(owner, reversed)).StatusCode);
        Assert.Equal(reversed, await ChannelIdsAsync(owner));
    }

    [Fact]
    public async Task ChannelNamesAreUniqueWithinTheServerWhateverTheirCase()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var name = $"unique-{Guid.NewGuid():N}";

        Assert.Equal(HttpStatusCode.Created, (await CreateAsync(owner, name, "text")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await CreateAsync(owner, name.ToUpperInvariant(), "voice")).StatusCode);

        var other = await CreateAsync(owner, $"other-{Guid.NewGuid():N}", "text");
        var otherId = await IdOfAsync(other);
        var renamed = await owner.PatchAsJsonAsync($"/api/admin/channels/{otherId}", new { name });
        Assert.Equal(HttpStatusCode.Conflict, renamed.StatusCode);
    }

    [Fact]
    public async Task ANameTakenAfterTheCheckIsAConflictAndLeavesNothingPending()
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var taken = await db.Channels.Select(x => x.Name).FirstAsync();
        db.Channels.Add(new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            Name = taken,
            Kind = ChannelKind.Text,
            Position = 99,
        });

        Assert.False(await db.TrySaveChangesAsync(CancellationToken.None));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task TwoRequestsForOneNameAtOnceEndInOneChannelAndNoServerError()
    {
        using var first = await SignedInAsync(_factory, "maja", "Aurora!2026");
        using var second = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var name = $"race-{Guid.NewGuid():N}";

        var responses = await Task.WhenAll(CreateAsync(first, name, "text"), CreateAsync(second, name, "text"));

        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData("two words", "text")]
    [InlineData("", "text")]
    [InlineData("under_score", "text")]
    [InlineData("fine-name", "forum")]
    [InlineData("fine-name", null)]
    public async Task ANameOrKindOutsideTheRulesIsRefused(string name, string? kind)
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");

        var response = await owner.PostAsJsonAsync("/api/admin/channels", new { name, kind });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("text", "slowModeSeconds", 21601)]
    [InlineData("text", "slowModeSeconds", -1)]
    [InlineData("text", "hideAfterInactivityHours", 8761)]
    [InlineData("text", "audioProfile", "studio")]
    [InlineData("text", "userLimit", 5)]
    [InlineData("voice", "userLimit", 100)]
    [InlineData("voice", "audioProfile", "ultra")]
    [InlineData("voice", "topic", "a topic")]
    [InlineData("voice", "slowModeSeconds", 10)]
    public async Task ASettingOutOfRangeOrForTheOtherKindOfChannelIsRefused(string kind, string setting, object value)
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var channelId = await IdOfAsync(await CreateAsync(owner, $"{kind}-{Guid.NewGuid():N}", kind));

        var response = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{channelId}",
            new Dictionary<string, object> { [setting] = value });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TheLastChannelOfAKindCannotBeDeleted()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");

        foreach (var removable in new[] { TestData.MemesChannelId, TestData.ProjectsChannelId, TestData.NightShiftChannelId })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/channels/{removable}")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/channels/{TestData.GeneralChannelId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/channels/{TestData.VoiceChannelId}")).StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Channels.CountAsync(x => x.Kind == ChannelKind.Text));
        Assert.Equal(1, await db.Channels.CountAsync(x => x.Kind == ChannelKind.Voice));
    }

    [Fact]
    public async Task ASectionThatStillHoldsChannelsCannotBeDeleted()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var sectionId = await IdOfAsync(await owner.PostAsJsonAsync(
            "/api/admin/sections", new { name = $"Held-{Guid.NewGuid():N}" }));
        var channelId = await IdOfAsync(await CreateAsync(owner, $"held-{Guid.NewGuid():N}", "text"));
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.PatchAsJsonAsync($"/api/admin/channels/{channelId}/section", new { sectionId })).StatusCode);

        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/sections/{sectionId}")).StatusCode);

        using var bootstrap = JsonDocument.Parse(await owner.GetStringAsync("/api/bootstrap"));
        Assert.Contains(
            bootstrap.RootElement.GetProperty("sections").EnumerateArray(),
            x => x.GetProperty("id").GetString() == sectionId);
        Assert.Equal(
            sectionId,
            bootstrap.RootElement.GetProperty("channels").EnumerateArray()
                .Single(x => x.GetProperty("id").GetString() == channelId)
                .GetProperty("sectionId").GetString());
    }

    [Fact]
    public async Task AChannelMovesOnlyIntoAnExistingSectionAndOnlyForAManager()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        using var moderator = await SignedInAsync(_factory, "ada", "Quasar!2026");
        var sectionId = await IdOfAsync(await owner.PostAsJsonAsync(
            "/api/admin/sections", new { name = $"Target-{Guid.NewGuid():N}" }));
        var path = $"/api/admin/channels/{TestData.GeneralChannelId}/section";

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PatchAsJsonAsync(path, new { sectionId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.PatchAsJsonAsync(path, new { sectionId })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PatchAsJsonAsync(path, new { sectionId })).StatusCode);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.PatchAsJsonAsync(path, new { sectionId = (string?)null })).StatusCode);
    }

    [Fact]
    public async Task SectionsAreAddedToADatabaseThatPredatesThem()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync(
                """
                DROP INDEX "IX_Channels_SectionId";
                ALTER TABLE "Channels" DROP COLUMN "SectionId";
                DROP TABLE "Sections";
                """);
        }

        // Twice: the steps run on every start, also on a database already upgraded.
        for (var run = 0; run < 2; run++)
        {
            await using var scope = factory.Services.CreateAsyncScope();
            await DatabaseSchema.UpgradeAsync(
                scope.ServiceProvider.GetRequiredService<AppDbContext>(), CancellationToken.None);
        }

        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");
        var sectionId = await IdOfAsync(await owner.PostAsJsonAsync("/api/admin/sections", new { name = "Wróciła" }));
        var assigned = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{TestData.GeneralChannelId}/section", new { sectionId });
        Assert.Equal(HttpStatusCode.NoContent, assigned.StatusCode);
    }

    [Fact]
    public async Task ASystemRoleCannotBeDeletedAndTheOwnerRoleCannotBeEdited()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");

        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/roles/{MemberRoleId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/roles/{OwnerRoleId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PatchAsJsonAsync($"/api/admin/roles/{OwnerRoleId}", new { name = "Szef" })).StatusCode);

        var roles = (await RolesAsync(owner)).Select(x => x.GetProperty("id").GetString()).ToArray();
        Assert.Contains(OwnerRoleId.ToString(), roles);
        Assert.Contains(MemberRoleId.ToString(), roles);
    }

    [Fact]
    public async Task ARoleCannotCarryAPermissionItsEditorDoesNotHold()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var steward = await SignedInAsync(factory, "jo", "Corona!2026");
        var board = await CreateRoleAsync(owner, "Zarząd", "manageRoles", "manageMembers");
        var admins = await CreateRoleAsync(owner, "Administracja", "manageServer");
        await AssignAsync(owner, JoId, board);

        Assert.Equal(HttpStatusCode.Forbidden, (await PostRoleAsync(steward, "Wyżej", "manageServer")).StatusCode);
        var below = await IdOfAsync(await PostRoleAsync(steward, "Niżej", "manageMembers"));

        var raised = await steward.PatchAsJsonAsync(
            $"/api/admin/roles/{below}", new { permissions = ManageMembersAndMessages });
        Assert.Equal(HttpStatusCode.Forbidden, raised.StatusCode);
        var renamed = await steward.PatchAsJsonAsync($"/api/admin/roles/{below}", new { name = "Niżej bis" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);

        // A role that carries what the editor lacks can be neither deleted, renamed nor handed out.
        Assert.Equal(HttpStatusCode.Forbidden, (await steward.DeleteAsync($"/api/admin/roles/{ModeratorRoleId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await steward.PatchAsJsonAsync($"/api/admin/roles/{admins}", new { name = "Inna" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await AssignAsync(steward, AdaId, admins)).StatusCode);
    }

    [Fact]
    public async Task AssigningARoleNeverInvolvesTheOwnerOrTheAssigner()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var steward = await SignedInAsync(factory, "jo", "Corona!2026");
        using var moderator = await SignedInAsync(factory, "ada", "Quasar!2026");
        await AssignAsync(owner, JoId, await CreateRoleAsync(owner, "Opiekunowie", "manageMembers"));

        Assert.Equal(HttpStatusCode.Forbidden, (await AssignAsync(owner, MajaId, MemberRoleId)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await AssignAsync(steward, JoId, MemberRoleId)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await AssignAsync(moderator, JoId, MemberRoleId)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await AssignAsync(steward, MajaId, MemberRoleId)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await AssignAsync(steward, AdaId, OwnerRoleId)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AssignAsync(steward, AdaId, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AssignAsync(steward, Guid.NewGuid(), MemberRoleId)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await AssignAsync(steward, AdaId, MemberRoleId)).StatusCode);
    }

    [Fact]
    public async Task DeletingARoleMovesItsMembersToTheMemberRoleAndTellsThem()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");
        var duty = await CreateRoleAsync(owner, "Dyżurni", "manageMessages");
        await using var listener = await PermissionListenerAsync(factory, "jo", "Corona!2026");

        Assert.Equal(HttpStatusCode.NoContent, (await AssignAsync(owner, JoId, duty)).StatusCode);
        var granted = await listener.NextAsync();
        Assert.Equal(TestData.ServerId.ToString(), granted.GetProperty("serverId").GetString());
        Assert.Equal(ManageMessages, granted.GetProperty("permissions").EnumerateArray().Select(x => x.GetString()));

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/roles/{duty}")).StatusCode);
        Assert.Empty((await listener.NextAsync()).GetProperty("permissions").EnumerateArray());

        var members = JsonDocument.Parse(await owner.GetStringAsync("/api/admin/members")).RootElement;
        Assert.Equal(
            MemberRoleId.ToString(),
            members.EnumerateArray().Single(x => x.GetProperty("user").GetProperty("id").GetString() == JoId.ToString())
                .GetProperty("roleId").GetString());
        Assert.DoesNotContain((await RolesAsync(owner)), x => x.GetProperty("id").GetString() == duty);
    }

    [Theory]
    [InlineData(null, "#fff", null)]
    [InlineData("  ", "#fff", null)]
    [InlineData("Za długa nazwa roli, która nie mieści się w sześćdziesięciu czterech znakach", "#fff", null)]
    [InlineData("Bez koloru", null, null)]
    [InlineData("Pusty kolor", " ", null)]
    [InlineData("Nieznane uprawnienie", "#fff", "flyToTheMoon")]
    [InlineData("Moderacja", "#fff", null)]
    public async Task ARoleNeedsAUniqueNameAColourAndKnownPermissions(string? name, string? color, string? permission)
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");

        var response = await owner.PostAsJsonAsync(
            "/api/admin/roles",
            new { name, color, permissions = permission is null ? Array.Empty<string>() : [permission] });

        Assert.Equal(
            name == "Moderacja" ? HttpStatusCode.Conflict : HttpStatusCode.BadRequest,
            response.StatusCode);
    }

    [Fact]
    public async Task EveryMemberCanListTheRolesWithTheirHoldersAndTheMembers()
    {
        using var member = await SignedInAsync(_factory, "jo", "Corona!2026");

        var roles = await RolesAsync(member);
        var memberRole = roles.Single(x => x.GetProperty("id").GetString() == MemberRoleId.ToString());
        Assert.True(memberRole.GetProperty("isSystem").GetBoolean());
        Assert.False(memberRole.GetProperty("isOwner").GetBoolean());
        Assert.True(memberRole.GetProperty("memberCount").GetInt32() >= 1);

        using var members = JsonDocument.Parse(await member.GetStringAsync("/api/admin/members"));
        Assert.All(
            members.RootElement.EnumerateArray(),
            x => Assert.True(DateTime.TryParse(x.GetProperty("joinedAt").GetString(), out _)));
        Assert.Equal(
            MemberNames,
            members.RootElement.EnumerateArray().Select(x => x.GetProperty("user").GetProperty("displayName").GetString()));
    }

    [Fact]
    public async Task AnOverrideOnASectionIsListedReplacedAndRemoved()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var sectionId = await IdOfAsync(await owner.PostAsJsonAsync(
            "/api/admin/sections", new { name = $"Override-{Guid.NewGuid():N}" }));
        var path = $"/api/admin/sections/{sectionId}/permissions";

        (await owner.PutAsJsonAsync($"{path}/{MemberRoleId}", new { allow = ManageMessages, deny = None }))
            .EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync($"{path}/{MemberRoleId}", new { allow = None, deny = ManageMessages }))
            .EnsureSuccessStatusCode();

        var listed = JsonDocument.Parse(await owner.GetStringAsync(path)).RootElement.EnumerateArray().ToArray();
        var only = Assert.Single(listed);
        Assert.Equal(MemberRoleId.ToString(), only.GetProperty("roleId").GetString());
        Assert.Empty(only.GetProperty("allow").EnumerateArray());
        Assert.Equal(ManageMessages, only.GetProperty("deny").EnumerateArray().Select(x => x.GetString()));

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"{path}/{MemberRoleId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"{path}/{MemberRoleId}")).StatusCode);
        Assert.Empty(JsonDocument.Parse(await owner.GetStringAsync(path)).RootElement.EnumerateArray());
    }

    [Theory]
    [InlineData("channels", "role")]
    [InlineData("channels", "target")]
    [InlineData("sections", "role")]
    [InlineData("sections", "target")]
    public async Task AnOverrideNeedsAnExistingTargetAndRole(string collection, string unknown)
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var target = unknown == "target"
            ? Guid.NewGuid()
            : collection == "channels" ? TestData.GeneralChannelId : await SectionIdAsync(owner);
        var role = unknown == "role" ? Guid.NewGuid() : MemberRoleId;

        var path = $"/api/admin/{collection}/{target}/permissions";
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PutAsJsonAsync($"{path}/{role}", new { allow = ManageMessages, deny = None })).StatusCode);
        if (unknown == "target")
        {
            Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"{path}/{role}")).StatusCode);
        }
    }

    [Fact]
    public async Task OverridesAreAddedToADatabaseThatPredatesThem()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("""DROP TABLE "PermissionOverrides";""");
        }

        for (var run = 0; run < 2; run++)
        {
            await using var scope = factory.Services.CreateAsyncScope();
            await DatabaseSchema.UpgradeAsync(
                scope.ServiceProvider.GetRequiredService<AppDbContext>(), CancellationToken.None);
        }

        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");
        var path = $"/api/admin/channels/{TestData.GeneralChannelId}/permissions/{MemberRoleId}";
        (await owner.PutAsJsonAsync(path, new { allow = ManageMessages, deny = None })).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync(path, new { allow = None, deny = ManageMessages })).EnsureSuccessStatusCode();
        var listed = JsonDocument.Parse(await owner.GetStringAsync(path[..path.LastIndexOf('/')])).RootElement;
        Assert.Equal(1, listed.GetArrayLength());
    }

    private static async Task<Guid> SectionIdAsync(HttpClient client) =>
        Guid.Parse(await IdOfAsync(await client.PostAsJsonAsync(
            "/api/admin/sections", new { name = $"Target-{Guid.NewGuid():N}" })));

    private static async Task<JsonElement[]> RolesAsync(HttpClient client) =>
        JsonDocument.Parse(await client.GetStringAsync("/api/admin/roles")).RootElement.EnumerateArray().ToArray();

    private static Task<HttpResponseMessage> PostRoleAsync(HttpClient client, string name, params string[] permissions) =>
        client.PostAsJsonAsync("/api/admin/roles", new { name, color = "#7c6ff0", permissions });

    private static async Task<string> CreateRoleAsync(HttpClient client, string name, params string[] permissions) =>
        await IdOfAsync(await PostRoleAsync(client, name, permissions));

    private static Task<HttpResponseMessage> AssignAsync(HttpClient client, Guid userId, object roleId) =>
        client.PatchAsJsonAsync($"/api/admin/members/{userId}/role", new { roleId });

    /// <summary>A hub connection of one account that keeps every PermissionsChanged it is sent.</summary>
    private static async Task<PermissionListener> PermissionListenerAsync(
        StellarrWebApplicationFactory factory, string username, string password)
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
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
        var listener = new PermissionListener(connection);

        // The hub speaks first once the connection has joined its groups.
        var joined = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = connection.On<JsonElement>("PresenceChanged", _ => joined.TrySetResult());
        await connection.StartAsync();
        await joined.Task.WaitAsync(TimeSpan.FromSeconds(10));
        return listener;
    }

    private sealed class PermissionListener : IAsyncDisposable
    {
        private readonly HubConnection _connection;
        private readonly System.Threading.Channels.Channel<JsonElement> _events = System.Threading.Channels.Channel.CreateUnbounded<JsonElement>();

        public PermissionListener(HubConnection connection)
        {
            _connection = connection;
            connection.On<JsonElement>("PermissionsChanged", payload => _events.Writer.TryWrite(payload));
        }

        public async Task<JsonElement> NextAsync() =>
            await _events.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }

    private static Task<HttpResponseMessage> ReorderAsync(HttpClient client, IEnumerable<Guid> ids) =>
        client.PutAsJsonAsync("/api/admin/channels/order", new { channelIds = ids });

    private static Task<HttpResponseMessage> CreateAsync(HttpClient client, string name, string kind) =>
        client.PostAsJsonAsync("/api/admin/channels", new { name, kind });

    private static async Task<string> IdOfAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("id").GetString()!;
    }

    private static async Task<Guid[]> ChannelIdsAsync(HttpClient client)
    {
        using var bootstrap = JsonDocument.Parse(await client.GetStringAsync("/api/bootstrap"));
        return bootstrap.RootElement.GetProperty("channels").EnumerateArray()
            .Select(x => Guid.Parse(x.GetProperty("id").GetString()!)).ToArray();
    }

    private static async Task<HttpClient> SignedInAsync(
        StellarrWebApplicationFactory factory, string username, string password)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        return client;
    }
}
