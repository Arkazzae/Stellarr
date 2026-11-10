using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Stellarr.Api.Tests;

/// <summary>What adding and removing a reaction promise beyond the happy path.</summary>
public sealed class MessageReactionTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly string Thumbs = Uri.EscapeDataString("👍");

    [Fact]
    public async Task AskingTwiceLeavesOneReactionAndTakingItBackIsRepeatableToo()
    {
        using var client = await SignInAsync("maja", "Aurora!2026");
        var messageId = await PostAsync(client, "reakcja na dwa razy");

        var first = await ReactAsync(client.PutAsync($"/api/messages/{messageId}/reactions/{Thumbs}", null));
        var second = await ReactAsync(client.PutAsync($"/api/messages/{messageId}/reactions/{Thumbs}", null));
        Assert.Equal(1, first.GetProperty("count").GetInt32());
        Assert.Equal(1, second.GetProperty("count").GetInt32());
        Assert.True(second.GetProperty("added").GetBoolean());
        Assert.Equal(messageId, second.GetProperty("messageId").GetString());
        Assert.Equal(TestData.GeneralChannelId.ToString(), second.GetProperty("channelId").GetString());
        Assert.Equal("👍", second.GetProperty("emoji").GetString());

        var removed = await ReactAsync(client.DeleteAsync($"/api/messages/{messageId}/reactions/{Thumbs}"));
        var removedAgain = await ReactAsync(client.DeleteAsync($"/api/messages/{messageId}/reactions/{Thumbs}"));
        Assert.Equal(0, removed.GetProperty("count").GetInt32());
        Assert.Equal(0, removedAgain.GetProperty("count").GetInt32());
        Assert.False(removedAgain.GetProperty("added").GetBoolean());
    }

    [Fact]
    public async Task TheCountIsTheTotalOfEveryoneWhoPickedTheEmoji()
    {
        using var maja = await SignInAsync("maja", "Aurora!2026");
        using var ada = await SignInAsync("ada", "Quasar!2026");
        var messageId = await PostAsync(maja, "dla wielu");

        await ReactAsync(maja.PutAsync($"/api/messages/{messageId}/reactions/{Thumbs}", null));
        var total = await ReactAsync(ada.PutAsync($"/api/messages/{messageId}/reactions/{Thumbs}", null));
        Assert.Equal(2, total.GetProperty("count").GetInt32());

        // Taking back one's own reaction leaves the other person's.
        var afterRemoval = await ReactAsync(ada.DeleteAsync($"/api/messages/{messageId}/reactions/{Thumbs}"));
        Assert.Equal(1, afterRemoval.GetProperty("count").GetInt32());
    }

    [Theory]
    [InlineData("%20")]
    [InlineData("two%20words")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public async Task AnEmojiThatIsEmptySpacedOrTooLongIsRejected(string emoji)
    {
        using var client = await SignInAsync("maja", "Aurora!2026");
        var messageId = await PostAsync(client, "zła reakcja");

        var response = await client.PutAsync($"/api/messages/{messageId}/reactions/{emoji}", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("emoji", out _));
    }

    [Fact]
    public async Task AMessageThatIsNotThereIsNotFound()
    {
        using var client = await SignInAsync("maja", "Aurora!2026");

        var response = await client.PutAsync($"/api/messages/{Guid.NewGuid()}/reactions/{Thumbs}", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AReactionIsAChangeOfItsMessageForClientsThatResync()
    {
        using var client = await SignInAsync("maja", "Aurora!2026");
        var messageId = await PostAsync(client, "widoczna po synchronizacji");
        var history = await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages?limit=1");
        var cursor = history.GetProperty("syncCursor").GetString();

        await ReactAsync(client.PutAsync($"/api/messages/{messageId}/reactions/{Thumbs}", null));

        var sync = await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/sync?after={cursor}");
        var change = Assert.Single(sync.GetProperty("changes").EnumerateArray());
        Assert.Equal("upsert", change.GetProperty("kind").GetString());
        var reaction = Assert.Single(change.GetProperty("message").GetProperty("reactions").EnumerateArray());
        Assert.Equal("👍", reaction.GetProperty("emoji").GetString());
        Assert.True(reaction.GetProperty("mine").GetBoolean());
    }

    private async Task<HttpClient> SignInAsync(string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<string> PostAsync(HttpClient client, string content)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content, attachmentIds = Array.Empty<Guid>() });
        response.EnsureSuccessStatusCode();
        var message = await response.Content.ReadFromJsonAsync<JsonElement>();
        return message.GetProperty("id").GetString()!;
    }

    private static async Task<JsonElement> ReactAsync(Task<HttpResponseMessage> request)
    {
        using var response = await request;
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
