using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class SectionFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string GeneralChannelId = "20000000-0000-0000-0000-000000000001";
    private readonly StellarrWebApplicationFactory _factory;

    public SectionFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task OwnerCanCreateRenameAssignReorderAndDeleteASection()
    {
        using var owner = Client();
        using var moderator = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(moderator, "ada", "Quasar!2026");

        var forbidden = await moderator.PostAsJsonAsync("/api/admin/sections", new { name = "Zakazana" });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var created = await owner.PostAsJsonAsync("/api/admin/sections", new { name = "Ogłoszenia" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var sectionId = createdJson.RootElement.GetProperty("id").GetString()!;
        Assert.Equal("Ogłoszenia", createdJson.RootElement.GetProperty("name").GetString());

        var renamed = await owner.PatchAsJsonAsync($"/api/admin/sections/{sectionId}", new { name = "Ważne" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        using (var renamedJson = JsonDocument.Parse(await renamed.Content.ReadAsStringAsync()))
        {
            Assert.Equal("Ważne", renamedJson.RootElement.GetProperty("name").GetString());
        }

        var assigned = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/section", new { sectionId });
        Assert.Equal(HttpStatusCode.NoContent, assigned.StatusCode);

        using (var bootstrap = JsonDocument.Parse(
            await (await owner.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync()))
        {
            var sections = bootstrap.RootElement.GetProperty("sections").EnumerateArray().ToArray();
            var owned = sections.Single(x => x.GetProperty("id").GetString() == sectionId);
            Assert.Equal("Ważne", owned.GetProperty("name").GetString());

            var channel = bootstrap.RootElement.GetProperty("channels").EnumerateArray()
                .Single(x => x.GetProperty("id").GetString() == GeneralChannelId);
            Assert.Equal(sectionId, channel.GetProperty("sectionId").GetString());
        }

        var blockedDelete = await owner.DeleteAsync($"/api/admin/sections/{sectionId}");
        Assert.Equal(HttpStatusCode.Conflict, blockedDelete.StatusCode);

        var unassigned = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{GeneralChannelId}/section", new { sectionId = (string?)null });
        Assert.Equal(HttpStatusCode.NoContent, unassigned.StatusCode);

        var deleted = await owner.DeleteAsync($"/api/admin/sections/{sectionId}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    }

    [Fact]
    public async Task ReorderRejectsAnIncompleteOrDuplicatedSet()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var first = await owner.PostAsJsonAsync("/api/admin/sections", new { name = "Pierwsza" });
        var second = await owner.PostAsJsonAsync("/api/admin/sections", new { name = "Druga" });
        var firstId = (await JsonDocument.ParseAsync(await first.Content.ReadAsStreamAsync()))
            .RootElement.GetProperty("id").GetString();

        var incomplete = await owner.PutAsJsonAsync("/api/admin/sections/order", new { sectionIds = new[] { firstId } });
        Assert.Equal(HttpStatusCode.BadRequest, incomplete.StatusCode);

        var duplicated = await owner.PutAsJsonAsync(
            "/api/admin/sections/order", new { sectionIds = new[] { firstId, firstId } });
        Assert.Equal(HttpStatusCode.BadRequest, duplicated.StatusCode);

        var secondId = (await JsonDocument.ParseAsync(await second.Content.ReadAsStreamAsync()))
            .RootElement.GetProperty("id").GetString();
        var reordered = await owner.PutAsJsonAsync(
            "/api/admin/sections/order", new { sectionIds = new[] { secondId, firstId } });
        Assert.Equal(HttpStatusCode.NoContent, reordered.StatusCode);

        using var bootstrap = JsonDocument.Parse(
            await (await owner.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync());
        var ordered = bootstrap.RootElement.GetProperty("sections").EnumerateArray()
            .Select(x => x.GetProperty("id").GetString()).ToArray();
        Assert.Equal(new[] { secondId, firstId }, ordered);
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
