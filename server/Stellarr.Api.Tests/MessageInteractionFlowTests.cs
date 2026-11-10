using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Stellarr.Api.Tests;

public sealed class MessageInteractionFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string GeneralChannelId = "20000000-0000-0000-0000-000000000001";
    private readonly StellarrWebApplicationFactory _factory;

    public MessageInteractionFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task RepliesAndReactionsSurviveAHistoryReadWithViewerState()
    {
        using var maja = await AuthenticatedClientAsync("maja", "Aurora!2026");
        using var ada = await AuthenticatedClientAsync("ada", "Quasar!2026");

        var rootResponse = await maja.PostAsJsonAsync(
            $"/api/channels/{GeneralChannelId}/messages",
            new { content = $"root-{Guid.NewGuid():N}", attachmentIds = Array.Empty<string>() });
        rootResponse.EnsureSuccessStatusCode();
        using var rootJson = JsonDocument.Parse(await rootResponse.Content.ReadAsStringAsync());
        var rootId = rootJson.RootElement.GetProperty("id").GetString()!;

        var replyResponse = await ada.PostAsJsonAsync(
            $"/api/channels/{GeneralChannelId}/messages",
            new
            {
                content = "reply-persisted",
                attachmentIds = Array.Empty<string>(),
                replyToMessageId = rootId,
            });
        replyResponse.EnsureSuccessStatusCode();
        using var replyJson = JsonDocument.Parse(await replyResponse.Content.ReadAsStringAsync());
        var replyTo = replyJson.RootElement.GetProperty("replyTo");
        Assert.Equal(rootId, replyTo.GetProperty("id").GetString());
        Assert.Equal("Maja", replyTo.GetProperty("authorName").GetString());

        var encodedEmoji = Uri.EscapeDataString("👍");
        var reactionResponse = await ada.PutAsync(
            $"/api/messages/{rootId}/reactions/{encodedEmoji}",
            content: null);
        reactionResponse.EnsureSuccessStatusCode();

        var majaRoot = await FindMessageAsync(maja, rootId);
        var majaReaction = Assert.Single(majaRoot.GetProperty("reactions").EnumerateArray());
        Assert.Equal(1, majaReaction.GetProperty("count").GetInt32());
        Assert.False(majaReaction.GetProperty("mine").GetBoolean());

        var adaRoot = await FindMessageAsync(ada, rootId);
        var adaReaction = Assert.Single(adaRoot.GetProperty("reactions").EnumerateArray());
        Assert.True(adaReaction.GetProperty("mine").GetBoolean());

        var removeResponse = await ada.DeleteAsync(
            $"/api/messages/{rootId}/reactions/{encodedEmoji}");
        removeResponse.EnsureSuccessStatusCode();
        Assert.Empty((await FindMessageAsync(ada, rootId))
            .GetProperty("reactions").EnumerateArray());
    }

    [Fact]
    public async Task ReplyCannotPointOutsideItsChannel()
    {
        const string announcementsChannelId = "20000000-0000-0000-0000-000000000003";
        using var client = await AuthenticatedClientAsync("maja", "Aurora!2026");
        var rootResponse = await client.PostAsJsonAsync(
            $"/api/channels/{GeneralChannelId}/messages",
            new { content = "cross-channel-root", attachmentIds = Array.Empty<string>() });
        rootResponse.EnsureSuccessStatusCode();
        using var rootJson = JsonDocument.Parse(await rootResponse.Content.ReadAsStringAsync());

        var response = await client.PostAsJsonAsync(
            $"/api/channels/{announcementsChannelId}/messages",
            new
            {
                content = "invalid reply",
                attachmentIds = Array.Empty<string>(),
                replyToMessageId = rootJson.RootElement.GetProperty("id").GetString(),
            });

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
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

    private static async Task<JsonElement> FindMessageAsync(HttpClient client, string messageId)
    {
        var history = await client.GetAsync(
            $"/api/channels/{GeneralChannelId}/messages?limit=100");
        history.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("messages").EnumerateArray()
            .Single(message => message.GetProperty("id").GetString() == messageId)
            .Clone();
    }
}
