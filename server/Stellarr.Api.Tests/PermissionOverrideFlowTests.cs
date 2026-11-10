using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class PermissionOverrideFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid ServerId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");
    private static readonly Guid ModeratorRoleId = Guid.Parse("60000000-0000-0000-0000-000000000002");
    private static readonly Guid MemberRoleId = Guid.Parse("60000000-0000-0000-0000-000000000003");
    private const string GeneralChannelId = "20000000-0000-0000-0000-000000000001";
    private static readonly string[] NoPermissions = [];
    private static readonly string[] ManageChannels = ["manageChannels"];
    private static readonly string[] ManageMessages = ["manageMessages"];
    private static readonly string[] UnknownPermission = ["flyToTheMoon"];
    private readonly StellarrWebApplicationFactory _factory;

    public PermissionOverrideFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task NonManagerCannotSetAnOverride()
    {
        using var member = Client();
        await LoginAsync(member, "jo", "Corona!2026");
        var forbidden = await member.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{ModeratorRoleId}",
            new { allow = NoPermissions, deny = ManageMessages });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [Fact]
    public async Task UnknownPermissionNameFailsValidation()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var response = await owner.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{ModeratorRoleId}",
            new { allow = UnknownPermission, deny = NoPermissions });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChannelOverrideDeniesAPermissionARoleOtherwiseHas()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var set = await owner.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{ModeratorRoleId}",
            new { allow = NoPermissions, deny = ManageMessages });
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        using (var setJson = JsonDocument.Parse(await set.Content.ReadAsStringAsync()))
        {
            Assert.Equal(ModeratorRoleId.ToString(), setJson.RootElement.GetProperty("roleId").GetString());
            Assert.Empty(setJson.RootElement.GetProperty("allow").EnumerateArray());
            Assert.Equal("manageMessages", setJson.RootElement.GetProperty("deny")[0].GetString());
        }

        var list = await owner.GetAsync($"/api/admin/channels/{GeneralChannelId}/permissions");
        using (var listJson = JsonDocument.Parse(await list.Content.ReadAsStringAsync()))
        {
            Assert.Single(listJson.RootElement.EnumerateArray());
        }

        // Moderacja has ManageMessages at the role level; the channel override denies it here.
        Assert.True(await HasChannelPermissionAsync(
            AdaId, Guid.Parse(GeneralChannelId), ServerPrivileges.ModerateMembers));
        Assert.False(await HasChannelPermissionAsync(
            AdaId, Guid.Parse(GeneralChannelId), ServerPrivileges.ManageMessages));

        var message = await owner.PostAsJsonAsync(
            $"/api/channels/{GeneralChannelId}/messages",
            new { content = $"override-{Guid.NewGuid():N}", attachmentIds = Array.Empty<string>() });
        message.EnsureSuccessStatusCode();
        using var messageJson = JsonDocument.Parse(await message.Content.ReadAsStringAsync());
        var messageId = messageJson.RootElement.GetProperty("id").GetString();
        using var moderator = Client();
        await LoginAsync(moderator, "ada", "Quasar!2026");
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.PutAsync($"/api/messages/{messageId}/pin", null)).StatusCode);
        (await owner.DeleteAsync($"/api/messages/{messageId}")).EnsureSuccessStatusCode();

        var cleared = await owner.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{ModeratorRoleId}",
            new { allow = NoPermissions, deny = NoPermissions });
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.True(await HasChannelPermissionAsync(
            AdaId, Guid.Parse(GeneralChannelId), ServerPrivileges.ManageMessages));
    }

    [Fact]
    public async Task SamePermissionCannotBeAllowedAndDeniedAtOnce()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var response = await owner.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{ModeratorRoleId}",
            new { allow = ManageMessages, deny = ManageMessages });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChannelOverrideWinsOverItsSectionOverride()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var section = await owner.PostAsJsonAsync("/api/admin/sections", new { name = "Sekcja precedencji" });
        var sectionId = (await JsonDocument.ParseAsync(await section.Content.ReadAsStreamAsync()))
            .RootElement.GetProperty("id").GetString()!;
        await owner.PatchAsJsonAsync($"/api/admin/channels/{GeneralChannelId}/section", new { sectionId });

        // Członek has no base permissions; the section grants ManageMessages...
        await owner.PutAsJsonAsync(
            $"/api/admin/sections/{sectionId}/permissions/{MemberRoleId}",
            new { allow = ManageMessages, deny = NoPermissions });
        Assert.True(await HasChannelPermissionAsync(
            JoId, Guid.Parse(GeneralChannelId), ServerPrivileges.ManageMessages));

        // ...but a channel-level deny on the same role and channel wins over the section grant.
        await owner.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{MemberRoleId}",
            new { allow = NoPermissions, deny = ManageMessages });
        Assert.False(await HasChannelPermissionAsync(
            JoId, Guid.Parse(GeneralChannelId), ServerPrivileges.ManageMessages));

        // Cleanup so this fixture-shared channel doesn't leak state into other tests.
        await owner.PatchAsJsonAsync($"/api/admin/channels/{GeneralChannelId}/section", new { sectionId = (string?)null });
        await owner.DeleteAsync($"/api/admin/sections/{sectionId}");
        await owner.PutAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/permissions/{MemberRoleId}",
            new { allow = NoPermissions, deny = NoPermissions });
    }

    [Fact]
    public async Task CreatingAChannelInsideASectionUsesThatSectionsOverride()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var section = await owner.PostAsJsonAsync("/api/admin/sections", new { name = "Sekcja tworzenia" });
        section.EnsureSuccessStatusCode();
        var sectionId = (await JsonDocument.ParseAsync(await section.Content.ReadAsStreamAsync()))
            .RootElement.GetProperty("id").GetString()!;

        (await owner.PutAsJsonAsync(
            $"/api/admin/sections/{sectionId}/permissions/{MemberRoleId}",
            new { allow = ManageChannels, deny = NoPermissions })).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync(
            $"/api/admin/sections/{sectionId}/permissions/{ModeratorRoleId}",
            new { allow = NoPermissions, deny = ManageChannels })).EnsureSuccessStatusCode();

        using var member = Client();
        await LoginAsync(member, "jo", "Corona!2026");
        var channelName = $"section-{Guid.NewGuid():N}";
        var created = await member.PostAsJsonAsync(
            "/api/admin/channels", new { name = channelName, kind = "text", sectionId });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var channelId = (await JsonDocument.ParseAsync(await created.Content.ReadAsStreamAsync()))
            .RootElement.GetProperty("id").GetString()!;

        using var moderator = Client();
        await LoginAsync(moderator, "ada", "Quasar!2026");
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.PostAsJsonAsync(
                "/api/admin/channels",
                new { name = $"denied-{Guid.NewGuid():N}", kind = "text", sectionId })).StatusCode);

        (await owner.DeleteAsync($"/api/admin/channels/{channelId}")).EnsureSuccessStatusCode();
        (await owner.DeleteAsync($"/api/admin/sections/{sectionId}")).EnsureSuccessStatusCode();
    }

    private async Task<bool> HasChannelPermissionAsync(Guid userId, Guid channelId, ServerPrivileges permission)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await ServerAccess.HasAsync(db, userId, ServerId, channelId, permission);
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
}
