using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class StabilityRegressionTests
{
    [Fact]
    public async Task RetryingChannelMessageWithSameClientIdIsIdempotent()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory);
        await LoginAsync(client, "maja", "Aurora!2026");
        var messageId = Guid.NewGuid();
        var payload = new
        {
            content = "tylko raz",
            attachmentIds = Array.Empty<Guid>(),
            clientMessageId = messageId,
        };

        var first = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages", payload);
        var retry = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages", payload);

        first.EnsureSuccessStatusCode();
        retry.EnsureSuccessStatusCode();
        Assert.Equal(
            messageId.ToString(),
            (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
        Assert.Equal(
            messageId.ToString(),
            (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Messages.CountAsync(x => x.Id == messageId));
    }

    [Fact]
    public async Task MessageSyncJournalReturnsMissedUpsertAndDelete()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory);
        await LoginAsync(client, "maja", "Aurora!2026");
        var history = await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages?limit=50");
        var cursor = history.GetProperty("syncCursor").GetString()!;
        var messageId = Guid.NewGuid();

        (await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new
            {
                content = "przerwa w sieci",
                attachmentIds = Array.Empty<Guid>(),
                clientMessageId = messageId,
            })).EnsureSuccessStatusCode();

        var upserts = await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/sync?after={cursor}");
        var upsert = Assert.Single(upserts.GetProperty("changes").EnumerateArray());
        Assert.Equal("upsert", upsert.GetProperty("kind").GetString());
        Assert.Equal(messageId.ToString(), upsert.GetProperty("messageId").GetString());
        cursor = upserts.GetProperty("nextCursor").GetString()!;

        (await client.DeleteAsync($"/api/messages/{messageId}"))
            .EnsureSuccessStatusCode();
        var deletes = await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/sync?after={cursor}");
        var deleted = Assert.Single(deletes.GetProperty("changes").EnumerateArray());
        Assert.Equal("delete", deleted.GetProperty("kind").GetString());
        Assert.Equal(messageId.ToString(), deleted.GetProperty("messageId").GetString());
    }

    [Fact]
    public async Task RetryingDirectMessageWithSameClientIdIsIdempotent()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = Client(factory);
        await LoginAsync(client, "maja", "Aurora!2026");
        var opened = await client.PostAsJsonAsync("/api/social/conversations", new
        {
            userId = Guid.Parse("30000000-0000-0000-0000-000000000002"),
        });
        opened.EnsureSuccessStatusCode();
        var conversationId = (await opened.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;
        var messageId = Guid.NewGuid();
        var payload = new
        {
            content = "prywatnie, raz",
            attachmentIds = Array.Empty<Guid>(),
            clientMessageId = messageId,
        };

        var first = await client.PostAsJsonAsync(
            $"/api/social/conversations/{conversationId}/messages", payload);
        var retry = await client.PostAsJsonAsync(
            $"/api/social/conversations/{conversationId}/messages", payload);

        first.EnsureSuccessStatusCode();
        retry.EnsureSuccessStatusCode();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.DirectMessages.CountAsync(x => x.Id == messageId));
    }

    [Fact]
    public async Task UploadIsRejectedBeforeStorageWhenUserQuotaIsExhausted()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?>
            {
                ["Uploads:MaxStoredBytesPerUser"] = "1",
                ["Uploads:MinimumFreeDataRootBytes"] = "0",
            });
        using var client = Client(factory);
        await LoginAsync(client, "maja", "Aurora!2026");
        using var form = new MultipartFormDataContent();
        var image = new ByteArrayContent(
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        form.Add(image, "file", "tiny.png");

        var response = await client.PostAsync("/api/uploads", form);

        Assert.Equal((HttpStatusCode)507, response.StatusCode);
        var storage = Assert.IsType<FakeObjectStorage>(
            factory.Services.GetRequiredService<Stellarr.Api.Storage.IObjectStorage>());
        Assert.Equal(0, storage.Count);
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
        .EnsureSuccessStatusCode();
}
