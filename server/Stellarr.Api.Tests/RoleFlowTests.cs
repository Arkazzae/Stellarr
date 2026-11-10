using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class RoleFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");
    private static readonly string[] ManageMessages = ["manageMessages"];
    private static readonly string[] ManageRoles = ["manageRoles"];
    private readonly StellarrWebApplicationFactory _factory;

    public RoleFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task OwnerCanCreateAndAssignRoleWhileServerEnforcesItsPermissions()
    {
        using var owner = Client();
        using var moderator = Client();
        using var member = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(moderator, "ada", "Quasar!2026");
        await LoginAsync(member, "jo", "Corona!2026");

        using (var ownerBootstrap = JsonDocument.Parse(await (await owner.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync()))
        {
            var permissions = ownerBootstrap.RootElement.GetProperty("permissions")
                .EnumerateArray().Select(x => x.GetString()).ToArray();
            Assert.Contains("manageRoles", permissions);
            Assert.Contains("manageMembers", permissions);
        }

        var forbidden = await moderator.PostAsJsonAsync("/api/admin/roles", new
        {
            name = "Niedozwolona",
            color = "#fff",
            permissions = Array.Empty<string>(),
        });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var created = await owner.PostAsJsonAsync("/api/admin/roles", new
        {
            name = "Porządkowi",
            color = "#7c6ff0",
            permissions = ManageMessages,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var roleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var roleId = roleJson.RootElement.GetProperty("id").GetString();

        var assigned = await owner.PatchAsJsonAsync(
            $"/api/admin/members/{JoId}/role", new { roleId });
        Assert.Equal(HttpStatusCode.NoContent, assigned.StatusCode);

        using (var memberBootstrap = JsonDocument.Parse(await (await member.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync()))
        {
            Assert.Equal("manageMessages", memberBootstrap.RootElement
                .GetProperty("permissions")[0].GetString());
        }

        Guid messageId;
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            messageId = await db.Messages.Where(x => x.AuthorId == AdaId)
                .Select(x => x.Id).FirstAsync();
        }
        Assert.Equal(HttpStatusCode.NoContent, (await member.DeleteAsync($"/api/messages/{messageId}")).StatusCode);

        var stillForbidden = await member.PostAsJsonAsync("/api/admin/roles", new
        {
            name = "Eskalacja",
            color = "#000",
            permissions = ManageRoles,
        });
        Assert.Equal(HttpStatusCode.Forbidden, stillForbidden.StatusCode);
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
