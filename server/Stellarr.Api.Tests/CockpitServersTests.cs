using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class CockpitServersTests
{
    [Fact]
    public async Task OnlyTheInstanceOwnerManagesServers()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");
        var own = await CreateServerAsync(member, "Jo's corner");

        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/cockpit/servers")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.DeleteAsync($"/api/cockpit/servers/{own}")).StatusCode);
    }

    [Fact]
    public async Task ListsEveryServerWithItsOwnerAndCounts()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var jo = Client(factory);
        await LoginAsync(jo, "jo", "Corona!2026");
        var corner = await CreateServerAsync(jo, "Jo's corner");
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");

        var servers = (await JsonAsync(await owner.GetAsync("/api/cockpit/servers"))).EnumerateArray().ToArray();

        Assert.Equal(2, servers.Length);
        var instance = servers[0];
        Assert.True(instance.GetProperty("isInstance").GetBoolean());
        Assert.Equal(TestData.ServerId.ToString(), instance.GetProperty("id").GetString());
        Assert.Equal("maja", instance.GetProperty("owner").GetProperty("username").GetString());
        Assert.Equal(5, instance.GetProperty("memberCount").GetInt32());
        Assert.Equal(5, instance.GetProperty("channelCount").GetInt32());
        var created = servers[1];
        Assert.Equal(corner, created.GetProperty("id").GetString());
        Assert.False(created.GetProperty("isInstance").GetBoolean());
        Assert.Equal("jo", created.GetProperty("owner").GetProperty("username").GetString());
        Assert.Equal(1, created.GetProperty("memberCount").GetInt32());
        Assert.True(created.GetProperty("isPublic").GetBoolean());
    }

    [Fact]
    public async Task HandsAServerToAnotherOfItsMembers()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var jo = Client(factory);
        await LoginAsync(jo, "jo", "Corona!2026");
        var corner = await CreateServerAsync(jo, "Jo's corner");
        using var ada = Client(factory);
        await LoginAsync(ada, "ada", "Quasar!2026");
        (await ada.PostAsync($"/api/servers/{corner}/join", null)).EnsureSuccessStatusCode();
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");

        var members = (await JsonAsync(await owner.GetAsync($"/api/cockpit/servers/{corner}/members"))).EnumerateArray().ToArray();
        var adaId = members.Single(x => x.GetProperty("username").GetString() == "ada").GetProperty("id").GetString();
        var joId = members.Single(x => x.GetProperty("isOwner").GetBoolean()).GetProperty("id").GetString();

        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync($"/api/cockpit/servers/{corner}/transfer", new { userId = joId })).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync($"/api/cockpit/servers/{corner}/transfer", new { userId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.PostAsJsonAsync($"/api/cockpit/servers/{corner}/transfer", new { userId = adaId })).StatusCode);

        var after = (await JsonAsync(await owner.GetAsync("/api/cockpit/servers"))).EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == corner);
        Assert.Equal("ada", after.GetProperty("owner").GetProperty("username").GetString());
        Assert.Equal(2, after.GetProperty("memberCount").GetInt32());
        var log = await (await owner.GetAsync("/api/cockpit/logs")).Content.ReadAsStringAsync();
        Assert.Contains("Jo's corner", log, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DeletesAServerButNeverTheInstanceServer()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var jo = Client(factory);
        await LoginAsync(jo, "jo", "Corona!2026");
        var corner = await CreateServerAsync(jo, "Jo's corner");
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");

        using var refusedDelete = await owner.DeleteAsync($"/api/cockpit/servers/{TestData.ServerId}");
        Assert.Equal(HttpStatusCode.Conflict, refusedDelete.StatusCode);
        using var refusedTransfer = await owner.PostAsJsonAsync(
            $"/api/cockpit/servers/{TestData.ServerId}/transfer",
            new { userId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.Conflict, refusedTransfer.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/cockpit/servers/{corner}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/cockpit/servers/{corner}")).StatusCode);
        var servers = (await JsonAsync(await owner.GetAsync("/api/cockpit/servers"))).EnumerateArray().ToArray();
        Assert.Single(servers);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/cockpit/servers/{corner}/members")).StatusCode);
    }

    private static async Task<string> CreateServerAsync(HttpClient client, string name)
    {
        var created = await JsonAsync(await client.PostAsJsonAsync("/api/servers", new
        {
            name,
            description = "a server of its own",
            isPublic = true,
        }));
        return created.GetProperty("id").GetString()!;
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) => factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
