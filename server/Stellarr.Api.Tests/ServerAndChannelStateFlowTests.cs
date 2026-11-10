using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Stellarr.Api.Tests;

public sealed class ServerAndChannelStateFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string GeneralChannelId = "20000000-0000-0000-0000-000000000001";
    private readonly StellarrWebApplicationFactory _factory;

    public ServerAndChannelStateFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task OwnerUpdatesServerProfileAndMembersReadItFromBootstrap()
    {
        using var owner = await AuthenticatedClientAsync("maja", "Aurora!2026");
        using var member = await AuthenticatedClientAsync("ada", "Quasar!2026");

        var forbidden = await member.PatchAsJsonAsync(
            "/api/admin/server",
            new { name = "Nie moje", description = "", isPublic = true });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var update = await owner.PatchAsJsonAsync(
            "/api/admin/server",
            new
            {
                name = "  Nowa Orbita  ",
                description = "  Publiczny opis serwera.  ",
                isPublic = true,
            });
        update.EnsureSuccessStatusCode();
        using var updated = JsonDocument.Parse(await update.Content.ReadAsStringAsync());
        Assert.Equal("Nowa Orbita", updated.RootElement.GetProperty("name").GetString());
        Assert.Equal("Publiczny opis serwera.", updated.RootElement.GetProperty("description").GetString());
        Assert.True(updated.RootElement.GetProperty("isPublic").GetBoolean());
        Assert.True(updated.RootElement.GetProperty("createdAt").GetDateTime() < DateTime.UtcNow);

        using var bootstrap = JsonDocument.Parse(
            await (await member.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync());
        var server = bootstrap.RootElement.GetProperty("server");
        Assert.Equal("Nowa Orbita", server.GetProperty("name").GetString());
        Assert.Equal("Publiczny opis serwera.", server.GetProperty("description").GetString());
        Assert.True(server.GetProperty("isPublic").GetBoolean());
    }

    [Fact]
    public async Task ChannelReadWatermarkIsInitializedAndPersists()
    {
        using var client = await AuthenticatedClientAsync("ada", "Quasar!2026");
        var before = await BootstrapReadAtAsync(client);

        var mark = await client.PutAsync(
            $"/api/channels/{GeneralChannelId}/read",
            content: null);
        mark.EnsureSuccessStatusCode();
        using var marked = JsonDocument.Parse(await mark.Content.ReadAsStringAsync());
        var markedAt = marked.RootElement.GetProperty("lastReadAt").GetDateTime();
        Assert.True(markedAt >= before);

        var after = await BootstrapReadAtAsync(client);
        Assert.True(after >= markedAt);
    }

    [Fact]
    public async Task SendingAMessageAdvancesTheAuthorsReadWatermark()
    {
        using var client = await AuthenticatedClientAsync("maja", "Aurora!2026");
        var before = await BootstrapReadAtAsync(client);
        var sent = await client.PostAsJsonAsync(
            $"/api/channels/{GeneralChannelId}/messages",
            new { content = $"read-own-{Guid.NewGuid():N}", attachmentIds = Array.Empty<string>() });
        sent.EnsureSuccessStatusCode();
        using var message = JsonDocument.Parse(await sent.Content.ReadAsStringAsync());
        var createdAt = message.RootElement.GetProperty("createdAt").GetDateTime();

        var after = await BootstrapReadAtAsync(client);
        Assert.True(after >= before);
        Assert.True(after >= createdAt);
    }

    private async Task<HttpClient> AuthenticatedClientAsync(string username, string password)
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new { username, password });
        login.EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<DateTime> BootstrapReadAtAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/bootstrap");
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("channelReads")
            .GetProperty(GeneralChannelId)
            .GetDateTime();
    }
}
