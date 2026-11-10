using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>The rules of moderation that <see cref="ModerationFlowTests"/> does not walk through.</summary>
public sealed class ModerationRulesTests
{
    private const string AdaId = "30000000-0000-0000-0000-000000000002";
    private const string IlyaId = "30000000-0000-0000-0000-000000000003";
    private const string JoId = "30000000-0000-0000-0000-000000000005";
    private const string ModeratorRoleId = "60000000-0000-0000-0000-000000000002";

    private static readonly string Salon = TestData.VoiceChannelId.ToString();
    private static readonly string NightShift = TestData.NightShiftChannelId.ToString();

    [Fact]
    public async Task ABanReasonIsTrimmedDefaultedAndLimitedToFiveHundredCharacters()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");

        var tooLong = await owner.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = new string('x', 501) });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.True(JsonDocument.Parse(await tooLong.Content.ReadAsStringAsync())
            .RootElement.GetProperty("errors").TryGetProperty("reason", out _));

        var blank = await owner.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = "   " });
        Assert.Equal(HttpStatusCode.Created, blank.StatusCode);
        Assert.Equal("Bez podanego powodu", (await blank.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());

        var limit = await owner.PostAsJsonAsync($"/api/admin/members/{IlyaId}/ban", new { reason = new string('x', 500) });
        Assert.Equal(HttpStatusCode.Created, limit.StatusCode);
        var listed = await owner.GetFromJsonAsync<JsonElement>("/api/admin/bans");
        Assert.Equal(2, listed.GetArrayLength());
    }

    [Fact]
    public async Task BanningAndKickingNeedTheirOwnPrivileges()
    {
        using var factory = new StellarrWebApplicationFactory();
        await SetModeratorPrivilegesAsync(factory, ServerPrivileges.ModerateMembers);
        using var moderator = await SignedInAsync(factory, "ada", "Quasar!2026");

        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.GetAsync("/api/admin/bans")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.DeleteAsync($"/api/admin/bans/{JoId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await moderator.DeleteAsync($"/api/admin/members/{JoId}")).StatusCode);

        await SetModeratorPrivilegesAsync(factory, ServerPrivileges.ManageBans);
        Assert.Equal(HttpStatusCode.OK, (await moderator.GetAsync("/api/admin/bans")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.DeleteAsync($"/api/admin/members/{IlyaId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Created,
            (await moderator.PostAsJsonAsync($"/api/admin/members/{IlyaId}/ban", new { reason = "x" })).StatusCode);
    }

    [Fact]
    public async Task OnlyAnExistingBanCanBeLiftedAndAMemberCanBeBannedOnce()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");

        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/admin/bans/{JoId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Created,
            (await owner.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = "x" })).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/admin/members/{JoId}")).StatusCode);
    }

    [Fact]
    public async Task VoiceActionsNeedVoiceChannelsOfTheServer()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");
        var text = TestData.GeneralChannelId.ToString();
        var unknown = Guid.NewGuid().ToString();

        foreach (var channel in new[] { text, unknown })
        {
            Assert.Equal(
                HttpStatusCode.NotFound,
                (await owner.DeleteAsync($"/api/admin/channels/{channel}/members/{JoId}")).StatusCode);
            Assert.Equal(
                HttpStatusCode.NotFound,
                (await owner.PatchAsJsonAsync(
                    $"/api/admin/channels/{channel}/members/{JoId}", new { targetChannelId = NightShift })).StatusCode);
            Assert.Equal(
                HttpStatusCode.NotFound,
                (await owner.PatchAsJsonAsync(
                    $"/api/admin/channels/{Salon}/members/{JoId}", new { targetChannelId = channel })).StatusCode);
        }
    }

    [Fact]
    public async Task MovingSomebodyWhoIsNotInTheChannelConflictsAndMovingWithinOneChannelDoesNothing()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");

        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PatchAsJsonAsync(
                $"/api/admin/channels/{Salon}/members/{JoId}", new { targetChannelId = NightShift })).StatusCode);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.PatchAsJsonAsync(
                $"/api/admin/channels/{Salon}/members/{JoId}", new { targetChannelId = Salon })).StatusCode);
    }

    [Fact]
    public async Task KickingSomebodyFromAVoiceChannelTheyAreNotInStillSucceeds()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/channels/{Salon}/members/{JoId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/admin/channels/{Salon}/members/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task AVoiceKickFollowsTheOverridesOfTheChannelItIsAbout()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using (var scope = factory.OpenScope(out var db))
        {
            db.PermissionOverrides.Add(new PermissionOverride
            {
                Id = Guid.NewGuid(),
                ServerId = TestData.ServerId,
                TargetType = PermissionTargetType.Channel,
                TargetId = TestData.VoiceChannelId,
                RoleId = Guid.Parse(ModeratorRoleId),
                DenyMask = ServerPrivileges.ModerateMembers,
            });
            await db.SaveChangesAsync();
        }
        using var moderator = await SignedInAsync(factory, "ada", "Quasar!2026");

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.DeleteAsync($"/api/admin/channels/{Salon}/members/{JoId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await moderator.DeleteAsync($"/api/admin/channels/{NightShift}/members/{JoId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.DeleteAsync($"/api/admin/channels/{NightShift}/members/{AdaId}")).StatusCode);
    }

    private static async Task SetModeratorPrivilegesAsync(
        StellarrWebApplicationFactory factory,
        ServerPrivileges privileges)
    {
        await using var scope = factory.OpenScope(out var db);
        var role = await db.ServerRoles.SingleAsync(x => x.Id == Guid.Parse(ModeratorRoleId));
        role.Permissions = privileges;
        await db.SaveChangesAsync();
    }

    private static async Task<HttpClient> SignedInAsync(StellarrWebApplicationFactory factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        return client;
    }
}
