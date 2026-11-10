using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// Editing and deleting a message that has already been sent.
///
/// The interesting half is who may: there is no role model on this server, so
/// "the author" is the whole of the answer, and a stranger gets 404 rather than
/// 403 — whether an id exists is not a thing to learn by probing.
/// </summary>
public sealed class MessageEditTests
{
    [Fact]
    public async Task AuthorCanRewriteAndDeleteTheirOwnMessage()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");

        var created = await SendAsync(client, "pierwsza wersja");
        var messageId = created.GetProperty("id").GetString();
        Assert.NotNull(messageId);
        // Never edited is null, not an empty string or a zero date.
        Assert.Equal(JsonValueKind.Null, created.GetProperty("editedAt").ValueKind);

        var edit = await client.PatchAsJsonAsync(
            $"/api/messages/{messageId}",
            new { content = "druga wersja" });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        var edited = await ReadJsonAsync(edit);
        Assert.Equal("druga wersja", edited.GetProperty("content").GetString());
        Assert.Equal(JsonValueKind.String, edited.GetProperty("editedAt").ValueKind);

        // The rewrite is what the next reader gets, not just what the editor saw.
        var history = await ReadJsonAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages"));
        var stored = history.GetProperty("messages")
            .EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == messageId);
        Assert.Equal("druga wersja", stored.GetProperty("content").GetString());

        var delete = await client.DeleteAsync($"/api/messages/{messageId}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        var after = await ReadJsonAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages"));
        Assert.DoesNotContain(
            after.GetProperty("messages").EnumerateArray(),
            x => x.GetProperty("id").GetString() == messageId);
    }

    [Fact]
    public async Task SomebodyElsesMessageIsNotFound()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var author = CreateClient(factory);
        await LogInAsync(author, "maja", "Aurora!2026");
        var messageId = (await SendAsync(author, "moja wiadomość"))
            .GetProperty("id").GetString();

        using var stranger = CreateClient(factory);
        await LogInAsync(stranger, "jo", "Corona!2026");

        var edit = await stranger.PatchAsJsonAsync(
            $"/api/messages/{messageId}",
            new { content = "nie moja" });
        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await stranger.DeleteAsync($"/api/messages/{messageId}")).StatusCode);

        // And it is still there, saying what its author said.
        var history = await ReadJsonAsync(
            await author.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages"));
        var stored = history.GetProperty("messages")
            .EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == messageId);
        Assert.Equal("moja wiadomość", stored.GetProperty("content").GetString());
    }

    [Fact]
    public async Task AnEmptyOrOverlongRewriteIsRejected()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");
        var messageId = (await SendAsync(client, "treść")).GetProperty("id").GetString();

        // Emptying a message is deleting it, and there is an endpoint for that.
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await client.PatchAsJsonAsync(
                $"/api/messages/{messageId}",
                new { content = "   " })).StatusCode);

        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await client.PatchAsJsonAsync(
                $"/api/messages/{messageId}",
                new { content = new string('x', MessageLimits.MaxContentLength + 1) })).StatusCode);
    }

    [Fact]
    public async Task SavingTheSameTextDoesNotMarkItEdited()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");
        var messageId = (await SendAsync(client, "bez zmian")).GetProperty("id").GetString();

        var edit = await client.PatchAsJsonAsync(
            $"/api/messages/{messageId}",
            new { content = "bez zmian" });
        edit.EnsureSuccessStatusCode();

        // Pressing save twice is not a second edit, and "(edytowano)" is a claim
        // about the message that has to stay true.
        Assert.Equal(
            JsonValueKind.Null,
            (await ReadJsonAsync(edit)).GetProperty("editedAt").ValueKind);
    }

    [Fact]
    public async Task EditingMessageRebuildsAndClearsItsEmbeds()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join(
            "; ",
            login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));

        var messageId = Guid.NewGuid();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var authorId = await db.Users.Where(x => x.Username == "maja")
                .Select(x => x.Id)
                .SingleAsync();
            db.Messages.Add(new Message
            {
                Id = messageId,
                ChannelId = TestData.GeneralChannelId,
                AuthorId = authorId,
                Content = "https://example.test/old",
                CreatedAt = DateTime.UtcNow,
            });
            db.MessageEmbeds.Add(new MessageEmbed
            {
                Id = Guid.NewGuid(),
                MessageId = messageId,
                Url = "https://example.test/old",
                Provider = "example.test",
                Domain = "example.test",
                Title = "Stary podgląd",
                Position = 0,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        await using var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        var updated = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = connection.On<JsonElement>("MessageEmbedsUpdated", payload =>
        {
            if (payload.GetProperty("messageId").GetString() == messageId.ToString())
            {
                updated.TrySetResult(payload);
            }
        });
        await connection.StartAsync();

        var edit = await client.PatchAsJsonAsync(
            $"/api/messages/{messageId}",
            new { content = "wiadomość bez linku" });
        edit.EnsureSuccessStatusCode();

        var update = await updated.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Empty(update.GetProperty("embeds").EnumerateArray());
        await using var verificationScope = factory.Services.CreateAsyncScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await verificationDb.MessageEmbeds.AnyAsync(x => x.MessageId == messageId));
    }

    private static HttpClient CreateClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LogInAsync(HttpClient client, string username, string password)
    {
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, string content)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content, attachmentIds = Array.Empty<Guid>() });
        response.EnsureSuccessStatusCode();
        return await ReadJsonAsync(response);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
