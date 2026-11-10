using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// The paging contract of the channel index: a cursor belongs to the one
/// result it was issued for, the pages of a result do not move while it is
/// read, the kind narrows a text search as it does a plain listing, and the
/// limits on the request are answered with validation errors.
/// </summary>
public sealed class MessageIndexCursorTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static string IndexUrl(Guid channelId, string? query = null, string kind = "all", int limit = 1, string? cursor = null) =>
        $"/api/channels/{channelId}/messages/index?kind={kind}&limit={limit}" +
        (query is null ? "" : $"&query={Uri.EscapeDataString(query)}") +
        (cursor is null ? "" : $"&cursor={Uri.EscapeDataString(cursor)}");

    [Fact]
    public async Task PagesWalkTheWholeResultOnceAndIgnoreWhatArrivesMeanwhile()
    {
        using var client = await SignInAsync();
        var token = NewToken();
        var sent = new List<string>();
        for (var index = 0; index < 3; index++)
        {
            sent.Add(await SendAsync(client, TestData.GeneralChannelId, $"{token} wiadomość"));
        }

        var seen = new List<string>();
        var first = await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token));
        seen.AddRange(first.Ids);
        Assert.NotNull(first.NextCursor);

        // Matching, and sent after the first page was read: not part of this result.
        await SendAsync(client, TestData.GeneralChannelId, $"{token} spóźniona");

        var cursor = first.NextCursor;
        while (cursor is not null)
        {
            var page = await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token, cursor: cursor));
            seen.AddRange(page.Ids);
            cursor = page.NextCursor;
        }

        Assert.Equal(sent.Order(), seen.Order());
    }

    [Fact]
    public async Task WithoutAQueryThePagesRunFromTheNewestMessageBack()
    {
        using var client = await SignInAsync();
        var older = await SendAsync(client, TestData.GeneralChannelId, $"{NewToken()} starsza");
        var newer = await SendAsync(client, TestData.GeneralChannelId, $"{NewToken()} nowsza");

        var first = await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId));
        Assert.Equal(newer, Assert.Single(first.Ids));
        Assert.NotNull(first.NextCursor);

        var second = await ReadPageAsync(
            client, IndexUrl(TestData.GeneralChannelId, cursor: first.NextCursor));
        Assert.Equal(older, Assert.Single(second.Ids));
    }

    [Fact]
    public async Task TheKindNarrowsATextSearchToo()
    {
        using var client = await SignInAsync();
        var token = NewToken();
        var plain = await SendAsync(client, TestData.GeneralChannelId, $"{token} zwykła");
        var rich = await StoreAttachedLinkAsync(token);

        Assert.Equal(
            new[] { plain, rich.ToString() }.Order(),
            (await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token, limit: 10))).Ids.Order());
        Assert.Equal(
            [rich.ToString()],
            (await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token, "media", 10))).Ids);
        Assert.Equal(
            [rich.ToString()],
            (await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token, "links", 10))).Ids);
    }

    [Fact]
    public async Task ACursorIsRefusedForAnotherChannelKindOrQuery()
    {
        using var client = await SignInAsync();
        var token = NewToken();
        await SendAsync(client, TestData.GeneralChannelId, $"{token} pierwsza");
        await SendAsync(client, TestData.GeneralChannelId, $"{token} druga");
        var cursor = (await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token))).NextCursor;
        Assert.NotNull(cursor);

        // Another text channel of the same server, so that the cursor is what is wrong.
        await AssertRejectedCursorAsync(client, IndexUrl(TestData.ProjectsChannelId, token, cursor: cursor));
        await AssertRejectedCursorAsync(client, IndexUrl(TestData.GeneralChannelId, token, kind: "media", cursor: cursor));
        await AssertRejectedCursorAsync(client, IndexUrl(TestData.GeneralChannelId, $"{token} druga", cursor: cursor));
        await AssertRejectedCursorAsync(client, IndexUrl(TestData.GeneralChannelId, cursor: cursor));

        // Repeating the request it was issued for is what it is for.
        var next = await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, token, cursor: cursor));
        Assert.Single(next.Ids);
    }

    [Theory]
    [InlineData("not a cursor")]
    [InlineData("AAAA")]
    public async Task ACursorThatWasNeverIssuedIsRefused(string cursor)
    {
        using var client = await SignInAsync();

        await AssertRejectedCursorAsync(client, IndexUrl(TestData.GeneralChannelId, cursor: cursor));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(101)]
    public async Task ALimitOutsideOneToAHundredIsAValidationError(int limit)
    {
        using var client = await SignInAsync();

        var response = await client.GetAsync(IndexUrl(TestData.GeneralChannelId, limit: limit));

        await AssertValidationErrorAsync(response, "limit");
    }

    [Fact]
    public async Task AHundredMessagesAPageIsAllowed()
    {
        using var client = await SignInAsync();

        var response = await client.GetAsync(IndexUrl(TestData.GeneralChannelId, limit: 100));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AnUnknownKindIsAValidationError()
    {
        using var client = await SignInAsync();

        var response = await client.GetAsync(IndexUrl(TestData.GeneralChannelId, kind: "audio"));

        await AssertValidationErrorAsync(response, "kind");
    }

    [Fact]
    public async Task AQueryOfOneCharacterIsAValidationErrorEverywhere()
    {
        using var client = await SignInAsync();
        const string query = "a";

        await AssertValidationErrorAsync(
            await client.GetAsync(IndexUrl(TestData.GeneralChannelId, query)), "query");
        await AssertValidationErrorAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages/search?query={query}"), "query");
    }

    [Fact]
    public async Task AQueryOfMoreThanTwoHundredCharactersIsAValidationErrorEverywhere()
    {
        using var client = await SignInAsync();
        var query = new string('a', 201);

        await AssertValidationErrorAsync(
            await client.GetAsync(IndexUrl(TestData.GeneralChannelId, query)), "query");
        await AssertValidationErrorAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages/search?query={query}"), "query");
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.GetAsync(IndexUrl(TestData.GeneralChannelId, new string('a', 200)))).StatusCode);
    }

    [Fact]
    public async Task SearchNeedsAQueryButTheIndexTreatsABlankOneAsNone()
    {
        using var client = await SignInAsync();

        await AssertValidationErrorAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages/search?query=%20%20"), "query");
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.GetAsync(IndexUrl(TestData.GeneralChannelId, query: "   "))).StatusCode);
    }

    [Fact]
    public async Task AQueryWithNoWordInItMatchesNothing()
    {
        using var client = await SignInAsync();
        await SendAsync(client, TestData.GeneralChannelId, $"{NewToken()} cokolwiek");

        var page = await ReadPageAsync(client, IndexUrl(TestData.GeneralChannelId, "!?"));

        Assert.Empty(page.Ids);
        Assert.Null(page.NextCursor);
    }

    [Fact]
    public async Task AChannelOfAnotherKindOrNoChannelAtAllIsNotFound()
    {
        using var client = await SignInAsync();

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync(IndexUrl(TestData.VoiceChannelId))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync(IndexUrl(Guid.NewGuid()))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/channels/{Guid.NewGuid()}/messages/search?query=orbita")).StatusCode);
    }

    private async Task<HttpClient> SignInAsync()
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
        return client;
    }

    /// <summary>Stores a message of maja's that carries both an attachment and a link, and returns its id.</summary>
    private async Task<Guid> StoreAttachedLinkAsync(string token)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var authorId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync();
        var attachment = new ImageAttachment
        {
            Id = Guid.NewGuid(),
            UploadedById = authorId,
            ObjectKey = $"tests/{Guid.NewGuid():N}.pdf",
            FileName = "zalacznik.pdf",
            ContentType = "application/pdf",
            SizeBytes = 42,
            CreatedAt = DateTime.UtcNow,
        };
        var message = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = TestData.GeneralChannelId,
            AuthorId = authorId,
            Content = $"{token} https://materialy.example/{token}",
            CreatedAt = DateTime.UtcNow,
            Attachments = [new MessageAttachment { AttachmentId = attachment.Id, Attachment = attachment }],
        };
        db.ImageAttachments.Add(attachment);
        db.Messages.Add(message);
        await db.SaveChangesAsync();
        return message.Id;
    }

    private static string NewToken() => Guid.NewGuid().ToString("N")[..10];

    private static async Task<string> SendAsync(HttpClient client, Guid channelId, string content)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages",
            new { content, attachmentIds = Array.Empty<Guid>() });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private static async Task<(string[] Ids, string? NextCursor)> ReadPageAsync(HttpClient client, string url)
    {
        var page = await client.GetFromJsonAsync<JsonElement>(url);
        return (
            page.GetProperty("messages").EnumerateArray().Select(x => x.GetProperty("id").GetString()!).ToArray(),
            page.GetProperty("nextCursor").GetString());
    }

    private static async Task AssertRejectedCursorAsync(HttpClient client, string url) =>
        await AssertValidationErrorAsync(await client.GetAsync(url), "cursor");

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty(field, out _));
    }
}
