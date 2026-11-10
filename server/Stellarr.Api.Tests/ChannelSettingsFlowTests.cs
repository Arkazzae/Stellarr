using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class ChannelSettingsFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string VoiceChannelId = "20000000-0000-0000-0000-000000000002";
    private readonly StellarrWebApplicationFactory _factory;

    public ChannelSettingsFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task OwnerCanChangeAndReadBackVoiceChannelSettings()
    {
        using var owner = Client();
        using var moderator = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(moderator, "ada", "Quasar!2026");

        var forbidden = await moderator.PatchAsJsonAsync(
            $"/api/admin/channels/{VoiceChannelId}",
            new { audioProfile = "studio" });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var updated = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{VoiceChannelId}",
            new { audioProfile = "studio", userLimit = 10 });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        using (var payload = JsonDocument.Parse(await updated.Content.ReadAsStringAsync()))
        {
            Assert.Equal(
                "studio",
                payload.RootElement.GetProperty("audioProfile").GetString());
            Assert.Equal(10, payload.RootElement.GetProperty("userLimit").GetInt32());
            Assert.False(payload.RootElement.TryGetProperty("screenShareQuality", out _));
        }

        using var bootstrap = JsonDocument.Parse(
            await (await owner.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync());
        var channel = bootstrap.RootElement.GetProperty("channels")
            .EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == VoiceChannelId);
        Assert.Equal("studio", channel.GetProperty("audioProfile").GetString());
        Assert.Equal(10, channel.GetProperty("userLimit").GetInt32());
        Assert.False(channel.TryGetProperty("screenShareQuality", out _));
    }

    [Fact]
    public async Task OwnerCanCreateChannelAndReadItBackFromBootstrap()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var created = await owner.PostAsJsonAsync(
            "/api/admin/channels",
            new { name = "nowy-kanał", kind = "text" });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using (var payload = JsonDocument.Parse(await created.Content.ReadAsStringAsync()))
        {
            Assert.Equal("nowy-kanał", payload.RootElement.GetProperty("name").GetString());
            Assert.Equal("text", payload.RootElement.GetProperty("kind").GetString());
        }

        using var bootstrap = JsonDocument.Parse(
            await (await owner.GetAsync("/api/bootstrap")).Content.ReadAsStringAsync());
        Assert.Contains(
            bootstrap.RootElement.GetProperty("channels").EnumerateArray(),
            channel => channel.GetProperty("name").GetString() == "nowy-kanał" &&
                channel.GetProperty("kind").GetString() == "text");
    }

    [Fact]
    public async Task SlowModeRejectsRapidMessagesButExemptsChannelManagers()
    {
        using var owner = Client();
        using var member = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(member, "jo", "Corona!2026");

        var created = await owner.PostAsJsonAsync(
            "/api/admin/channels",
            new { name = $"slow-{Guid.NewGuid():N}"[..24], kind = "text" });
        created.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var channelId = payload.RootElement.GetProperty("id").GetString();
        (await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{channelId}",
            new { slowModeSeconds = 60 })).EnsureSuccessStatusCode();

        var first = await member.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages",
            new { content = "first", attachmentIds = Array.Empty<string>() });
        var second = await member.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages",
            new { content = "second", attachmentIds = Array.Empty<string>() });

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        Assert.NotNull(second.Headers.RetryAfter);

        Assert.Equal(
            HttpStatusCode.Created,
            (await owner.PostAsJsonAsync(
                $"/api/channels/{channelId}/messages",
                new { content = "manager one", attachmentIds = Array.Empty<string>() })).StatusCode);
        Assert.Equal(
            HttpStatusCode.Created,
            (await owner.PostAsJsonAsync(
                $"/api/channels/{channelId}/messages",
                new { content = "manager two", attachmentIds = Array.Empty<string>() })).StatusCode);
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
