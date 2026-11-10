using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Stellarr.Api.Tests;

/// <summary>
/// Opening conversations and exchanging messages in them. Each test runs
/// against an application of its own, so conversations, read markers and
/// blocks never carry over from one test to the next.
/// </summary>
public sealed class DirectMessageFlowTests
{
    private static readonly Dictionary<string, (Guid Id, string Password)> People = new()
    {
        ["maja"] = (Guid.Parse("30000000-0000-0000-0000-000000000001"), "Aurora!2026"),
        ["ada"] = (Guid.Parse("30000000-0000-0000-0000-000000000002"), "Quasar!2026"),
        ["ilya"] = (Guid.Parse("30000000-0000-0000-0000-000000000003"), "Meteor!2026"),
    };

    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    [Fact]
    public async Task BothPeopleOpenTheSameConversation()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");

        var first = await OpenAsync(maja, "ada");
        var again = await OpenAsync(maja, "ada");
        var fromTheOtherSide = await OpenAsync(ada, "maja");

        Assert.Equal(first, again);
        Assert.Equal(first, fromTheOtherSide);
        var conversation = Assert.Single((await StateAsync(ada)).GetProperty("conversations").EnumerateArray());
        Assert.Equal(first, conversation.GetProperty("id").GetString());
        Assert.Equal("maja", conversation.GetProperty("peer").GetProperty("username").GetString());
        Assert.Equal(JsonValueKind.Null, conversation.GetProperty("lastMessage").ValueKind);
        Assert.Equal(0, conversation.GetProperty("unread").GetInt32());
    }

    [Fact]
    public async Task ConversationsAreNotOpenedWithOneselfAnUnknownAccountOrABlockedPerson()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");

        Assert.Equal(HttpStatusCode.NotFound, (await OpenResponseAsync(maja, People["maja"].Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await OpenResponseAsync(maja, Guid.NewGuid())).StatusCode);

        (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await OpenResponseAsync(maja, People["ada"].Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await OpenResponseAsync(ada, People["maja"].Id)).StatusCode);

        (await maja.DeleteAsync($"/api/social/blocks/{People["ada"].Id}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await OpenResponseAsync(maja, People["ada"].Id)).StatusCode);
    }

    [Fact]
    public async Task OnlyTheTwoPeopleCanReadWriteOrMarkAConversationRead()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ilya = await SignInAsync(factory, "ilya");
        var conversationId = await OpenAsync(maja, "ada");

        foreach (var id in new[] { conversationId, Guid.NewGuid().ToString() })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await ilya.GetAsync(MessagesUrl(id))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await SendResponseAsync(ilya, id, new { content = "wtrącam się" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await ilya.PostAsync($"/api/social/conversations/{id}/read", null)).StatusCode);
        }
    }

    [Fact]
    public async Task ContentIsTrimmedAndHasToBePresentAndWithinTheSharedLimit()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        var conversationId = await OpenAsync(maja, "ada");

        var trimmed = await SendResponseAsync(maja, conversationId, new { content = "  cześć  " });
        Assert.Equal(HttpStatusCode.Created, trimmed.StatusCode);
        Assert.Equal("cześć", (await trimmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("content").GetString());
        Assert.Equal(HttpStatusCode.Created, (await SendResponseAsync(maja, conversationId, new { content = new string('a', 20_000) })).StatusCode);

        foreach (var content in new[] { "", "   ", new string('a', 20_001) })
        {
            var rejected = await SendResponseAsync(maja, conversationId, new { content });
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            Assert.True((await rejected.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("content", out _));
        }

        var tooManyAttachments = await SendResponseAsync(maja, conversationId, new
        {
            content = "za dużo",
            attachmentIds = Enumerable.Range(0, 11).Select(_ => Guid.NewGuid()),
        });
        Assert.Equal(HttpStatusCode.BadRequest, tooManyAttachments.StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await SendResponseAsync(maja, conversationId, new { content = "x", clientMessageId = Guid.Empty })).StatusCode);
        Assert.Equal(2, (await HistoryAsync(maja, conversationId)).GetProperty("messages").GetArrayLength());
    }

    [Fact]
    public async Task AnAttachmentIsSentOnlyByTheOneWhoUploadedIt()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        var conversationId = await OpenAsync(maja, "ada");
        var attachmentId = await UploadAsync(maja);

        var borrowed = await SendResponseAsync(ada, conversationId, new { content = "cudze", attachmentIds = new[] { attachmentId } });
        Assert.Equal(HttpStatusCode.BadRequest, borrowed.StatusCode);
        Assert.True((await borrowed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("attachmentIds", out _));

        var sent = await SendResponseAsync(maja, conversationId, new { content = "", attachmentIds = new[] { attachmentId, attachmentId } });
        Assert.Equal(HttpStatusCode.Created, sent.StatusCode);
        var message = Assert.Single((await HistoryAsync(ada, conversationId)).GetProperty("messages").EnumerateArray());
        var attachment = Assert.Single(message.GetProperty("attachments").EnumerateArray());
        Assert.Equal(attachmentId, attachment.GetProperty("id").GetString());
        Assert.Equal("tiny.png", attachment.GetProperty("name").GetString());
    }

    [Fact]
    public async Task ARetriedSendIsAnsweredWithTheStoredMessageUnlessItDiffers()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        var conversationId = await OpenAsync(maja, "ada");
        var messageId = Guid.NewGuid();

        var sent = await SendResponseAsync(maja, conversationId, new { content = "raz", clientMessageId = messageId });
        var retried = await SendResponseAsync(maja, conversationId, new { content = "raz", clientMessageId = messageId });
        var edited = await SendResponseAsync(maja, conversationId, new { content = "dwa", clientMessageId = messageId });
        var stolen = await SendResponseAsync(ada, conversationId, new { content = "raz", clientMessageId = messageId });

        Assert.Equal(HttpStatusCode.Created, sent.StatusCode);
        Assert.Equal(HttpStatusCode.OK, retried.StatusCode);
        Assert.Equal(messageId.ToString(), (await retried.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.Conflict, edited.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stolen.StatusCode);
        Assert.Single((await HistoryAsync(maja, conversationId)).GetProperty("messages").EnumerateArray());
    }

    [Fact]
    public async Task SomeoneWhoTurnedDirectMessagesOffOnlyHearsFromFriends()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        (await ada.PatchAsJsonAsync("/api/me/preferences", new { allowDirectMessages = false })).EnsureSuccessStatusCode();
        var conversationId = await OpenAsync(maja, "ada");

        Assert.Equal(HttpStatusCode.Forbidden, (await SendResponseAsync(maja, conversationId, new { content = "halo" })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await SendResponseAsync(ada, conversationId, new { content = "ja mogę pisać" })).StatusCode);

        (await maja.PostAsJsonAsync("/api/social/requests", new { username = "ada" })).EnsureSuccessStatusCode();
        var request = Assert.Single((await StateAsync(ada)).GetProperty("requests").EnumerateArray());
        (await ada.PostAsync($"/api/social/requests/{request.GetProperty("id").GetString()}/accept", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Created, (await SendResponseAsync(maja, conversationId, new { content = "teraz tak" })).StatusCode);
    }

    [Fact]
    public async Task ABlockClosesTheConversationUntilItIsLifted()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        var conversationId = await OpenAsync(maja, "ada");
        await SendAsync(maja, conversationId, "przed blokadą");

        (await maja.PostAsync($"/api/social/blocks/{People["ada"].Id}", null)).EnsureSuccessStatusCode();

        foreach (var client in new[] { maja, ada })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(MessagesUrl(conversationId))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await SendResponseAsync(client, conversationId, new { content = "nic" })).StatusCode);
            Assert.Empty((await StateAsync(client)).GetProperty("conversations").EnumerateArray());
        }

        (await maja.DeleteAsync($"/api/social/blocks/{People["ada"].Id}")).EnsureSuccessStatusCode();

        Assert.Equal("przed blokadą", Assert.Single(
            (await HistoryAsync(ada, conversationId)).GetProperty("messages").EnumerateArray())
            .GetProperty("content").GetString());
        Assert.Single((await StateAsync(ada)).GetProperty("conversations").EnumerateArray());
    }

    [Fact]
    public async Task HistoryPagesBackFromTheMomentTheFirstPageWasRead()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        var conversationId = await OpenAsync(maja, "ada");
        foreach (var number in Enumerable.Range(1, 5))
        {
            await SendAsync(maja, conversationId, $"m{number}");
        }

        var newest = await HistoryAsync(maja, conversationId, "limit=2");
        await SendAsync(maja, conversationId, "m6");
        var middle = await HistoryAsync(maja, conversationId, $"limit=2&cursor={newest.GetProperty("nextCursor").GetString()}");
        var oldest = await HistoryAsync(maja, conversationId, $"limit=2&cursor={middle.GetProperty("nextCursor").GetString()}");

        Assert.Equal(["m4", "m5"], Contents(newest));
        Assert.Equal(["m2", "m3"], Contents(middle));
        Assert.Equal(["m1"], Contents(oldest));
        Assert.Equal(JsonValueKind.Null, oldest.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task HistoryRefusesAnOutOfRangeLimitAndACursorThatIsNotThisConversations()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        var withAda = await OpenAsync(maja, "ada");
        var withIlya = await OpenAsync(maja, "ilya");
        await SendAsync(maja, withAda, "jeden");
        await SendAsync(maja, withAda, "dwa");
        var cursor = (await HistoryAsync(maja, withAda, "limit=1")).GetProperty("nextCursor").GetString();

        foreach (var query in new[] { "limit=0", "limit=101", "cursor=not-a-cursor", $"cursor={cursor}" })
        {
            var response = await maja.GetAsync($"{MessagesUrl(withIlya)}?{query}");
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        Assert.Equal(HttpStatusCode.OK, (await maja.GetAsync($"{MessagesUrl(withAda)}?limit=100&cursor={cursor}")).StatusCode);
    }

    [Fact]
    public async Task UnreadCountsTheOtherPersonsMessagesAfterTheReadMarker()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        using var ada = await SignInAsync(factory, "ada");
        var conversationId = await OpenAsync(maja, "ada");

        await SendAsync(maja, conversationId, "pierwsza");
        await SendAsync(maja, conversationId, "druga");
        Assert.Equal(0, await UnreadAsync(maja));
        Assert.Equal(2, await UnreadAsync(ada));

        // Answering shows everything before the answer to have been read.
        await SendAsync(ada, conversationId, "odpowiedź");
        Assert.Equal(0, await UnreadAsync(ada));
        Assert.Equal(1, await UnreadAsync(maja));

        Assert.Equal(HttpStatusCode.NoContent, (await maja.PostAsync($"/api/social/conversations/{conversationId}/read", null)).StatusCode);
        Assert.Equal(0, await UnreadAsync(maja));
    }

    [Fact]
    public async Task ConversationsAreListedByTheirLatestActivity()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await SignInAsync(factory, "maja");
        var withAda = await OpenAsync(maja, "ada");
        var withIlya = await OpenAsync(maja, "ilya");

        Assert.Equal([withIlya, withAda], await ConversationIdsAsync(maja));
        await SendAsync(maja, withAda, "do ady");
        Assert.Equal([withAda, withIlya], await ConversationIdsAsync(maja));
        await SendAsync(maja, withIlya, "do ilyi");
        Assert.Equal([withIlya, withAda], await ConversationIdsAsync(maja));
    }

    private static async Task<HttpClient> SignInAsync(StellarrWebApplicationFactory factory, string username)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password = People[username].Password }))
            .EnsureSuccessStatusCode();
        return client;
    }

    private static Task<HttpResponseMessage> OpenResponseAsync(HttpClient client, Guid userId) =>
        client.PostAsJsonAsync("/api/social/conversations", new { userId });

    private static async Task<string> OpenAsync(HttpClient client, string username)
    {
        var response = await OpenResponseAsync(client, People[username].Id);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private static string MessagesUrl(string conversationId) => $"/api/social/conversations/{conversationId}/messages";

    private static Task<HttpResponseMessage> SendResponseAsync(HttpClient client, string conversationId, object body) =>
        client.PostAsJsonAsync(MessagesUrl(conversationId), body);

    private static async Task SendAsync(HttpClient client, string conversationId, string content) =>
        Assert.Equal(HttpStatusCode.Created, (await SendResponseAsync(client, conversationId, new { content })).StatusCode);

    private static async Task<JsonElement> HistoryAsync(HttpClient client, string conversationId, string? query = null) =>
        await client.GetFromJsonAsync<JsonElement>(query is null ? MessagesUrl(conversationId) : $"{MessagesUrl(conversationId)}?{query}");

    private static string[] Contents(JsonElement page) =>
        [.. page.GetProperty("messages").EnumerateArray().Select(x => x.GetProperty("content").GetString()!)];

    private static async Task<JsonElement> StateAsync(HttpClient client) =>
        await client.GetFromJsonAsync<JsonElement>("/api/social");

    private static async Task<int> UnreadAsync(HttpClient client) =>
        (await StateAsync(client)).GetProperty("conversations")[0].GetProperty("unread").GetInt32();

    private static async Task<string[]> ConversationIdsAsync(HttpClient client) =>
        [.. (await StateAsync(client)).GetProperty("conversations").EnumerateArray().Select(x => x.GetProperty("id").GetString()!)];

    private static async Task<string> UploadAsync(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var image = new ByteArrayContent(Png);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        form.Add(image, "file", "tiny.png");
        var upload = await client.PostAsync("/api/uploads", form);
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        return (await upload.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }
}
