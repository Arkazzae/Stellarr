using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class MessageThreadListTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly HttpClient _client;

    public MessageThreadListTests(StellarrWebApplicationFactory factory)
    {
        _client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
    }

    [Fact]
    public async Task ListsEveryThreadAndLoadsItsCompleteConversation()
    {
        await LoginAsync();
        var token = Guid.NewGuid().ToString("N")[..8];
        var root = await SendAsync($"Plan wyprawy {token}");
        var rootId = root.GetProperty("id").GetString()!;
        var firstReply = await SendAsync("Pierwsza odpowiedź", rootId);
        var secondReply = await SendAsync("Druga odpowiedź", rootId);
        await SendAsync($"Zwykła wiadomość {token}");

        var catalogue = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/threads");
        var summary = catalogue.EnumerateArray().Single(item =>
            item.GetProperty("root").GetProperty("id").GetString() == rootId);

        Assert.Equal(TestData.GeneralChannelId.ToString(), summary.GetProperty("channelId").GetString());
        Assert.Equal(2, summary.GetProperty("replyCount").GetInt32());
        Assert.Contains(token, summary.GetProperty("root").GetProperty("preview").GetString());
        Assert.Equal(JsonValueKind.String, summary.GetProperty("lastReplyAt").ValueKind);

        var thread = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/threads/{rootId}");
        var ids = thread.GetProperty("messages").EnumerateArray()
            .Select(item => item.GetProperty("id").GetString())
            .ToArray();

        Assert.Equal(3, ids.Length);
        Assert.Equal(rootId, ids[0]);
        Assert.Equal(firstReply.GetProperty("id").GetString(), ids[1]);
        Assert.Equal(secondReply.GetProperty("id").GetString(), ids[2]);
    }

    private async Task LoginAsync()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });
        response.EnsureSuccessStatusCode();
    }

    private async Task<JsonElement> SendAsync(string content, string? replyToMessageId = null)
    {
        var response = await _client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new
            {
                content,
                attachmentIds = Array.Empty<string>(),
                replyToMessageId,
            });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
