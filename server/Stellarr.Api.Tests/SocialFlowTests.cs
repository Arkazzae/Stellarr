using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class SocialFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public SocialFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task FriendshipAndDirectMessagesPersistBetweenTwoAccounts()
    {
        using var maja = Client();
        using var ada = Client();
        await LoginAsync(maja, "maja", "Aurora!2026");
        await LoginAsync(ada, "ada", "Quasar!2026");

        var requestResponse = await maja.PostAsJsonAsync(
            "/api/social/requests", new { username = "@ada" });
        requestResponse.EnsureSuccessStatusCode();
        using (var answer = JsonDocument.Parse(await requestResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal("sent", answer.RootElement.GetProperty("result").GetString());
        }

        var adaState = await StateAsync(ada);
        var incoming = Assert.Single(adaState.GetProperty("requests").EnumerateArray());
        Assert.Equal("incoming", incoming.GetProperty("direction").GetString());
        Assert.Equal("maja", incoming.GetProperty("user").GetProperty("username").GetString());

        var accept = await ada.PostAsync(
            $"/api/social/requests/{incoming.GetProperty("id").GetString()}/accept", null);
        Assert.Equal(HttpStatusCode.NoContent, accept.StatusCode);
        Assert.Equal("ada", Assert.Single((await StateAsync(maja)).GetProperty("friends").EnumerateArray())
            .GetProperty("user").GetProperty("username").GetString());

        var adaId = (await StateAsync(maja)).GetProperty("friends")[0]
            .GetProperty("user").GetProperty("id").GetString();
        var opened = await maja.PostAsJsonAsync(
            "/api/social/conversations", new { userId = adaId });
        opened.EnsureSuccessStatusCode();
        using var openedJson = JsonDocument.Parse(await opened.Content.ReadAsStringAsync());
        var conversationId = openedJson.RootElement.GetProperty("id").GetString();

        foreach (var content in new[]
                 {
                     "prywatna wiadomość z backendu",
                     "druga wiadomość",
                     "trzecia wiadomość",
                 })
        {
            var sent = await maja.PostAsJsonAsync(
                $"/api/social/conversations/{conversationId}/messages",
                new { content });
            Assert.Equal(HttpStatusCode.Created, sent.StatusCode);
        }

        adaState = await StateAsync(ada);
        var conversation = Assert.Single(adaState.GetProperty("conversations").EnumerateArray());
        Assert.Equal(3, conversation.GetProperty("unread").GetInt32());
        Assert.Equal("trzecia wiadomość",
            conversation.GetProperty("lastMessage").GetProperty("content").GetString());

        var history = await ada.GetAsync(
            $"/api/social/conversations/{conversationId}/messages?limit=2");
        history.EnsureSuccessStatusCode();
        string cursor;
        using (var messages = JsonDocument.Parse(await history.Content.ReadAsStringAsync()))
        {
            Assert.Equal(
                ["druga wiadomość", "trzecia wiadomość"],
                messages.RootElement.GetProperty("messages").EnumerateArray()
                    .Select(value => value.GetProperty("content").GetString()!).ToArray());
            cursor = messages.RootElement.GetProperty("nextCursor").GetString()!;
            Assert.NotEmpty(cursor);
        }

        var olderHistory = await ada.GetAsync(
            $"/api/social/conversations/{conversationId}/messages?limit=2&cursor={cursor}");
        olderHistory.EnsureSuccessStatusCode();
        using (var messages = JsonDocument.Parse(await olderHistory.Content.ReadAsStringAsync()))
        {
            Assert.Equal("prywatna wiadomość z backendu",
                Assert.Single(messages.RootElement.GetProperty("messages").EnumerateArray())
                    .GetProperty("content").GetString());
            Assert.Equal(JsonValueKind.Null,
                messages.RootElement.GetProperty("nextCursor").ValueKind);
        }

        var read = await ada.PostAsync($"/api/social/conversations/{conversationId}/read", null);
        Assert.Equal(HttpStatusCode.NoContent, read.StatusCode);
        Assert.Equal(0, (await StateAsync(ada)).GetProperty("conversations")[0]
            .GetProperty("unread").GetInt32());
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(
        HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login", new { username, password });
        response.EnsureSuccessStatusCode();
    }

    private static async Task<JsonElement> StateAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/social");
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
