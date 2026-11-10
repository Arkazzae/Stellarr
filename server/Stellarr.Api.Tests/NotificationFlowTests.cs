using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class NotificationFlowTests
{
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task InboxIsPrivateCursorPagedAndSupportsReadAndDeleteLifecycle()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var ada = await AuthenticatedClientAsync(factory, "ada", "Quasar!2026");
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var createdAt = DateTime.UtcNow;
            db.UserNotifications.AddRange(
                Notification(firstId, AdaId, "First", createdAt),
                Notification(secondId, AdaId, "Second", createdAt.AddSeconds(1), TestData.GeneralChannelId),
                Notification(otherUserId, MajaId, "Private to Maja", createdAt.AddSeconds(2)));
            await db.SaveChangesAsync();
        }

        var firstPage = await ada.GetFromJsonAsync<JsonElement>("/api/notifications?limit=1");
        Assert.Equal(2, firstPage.GetProperty("unreadCount").GetInt32());
        Assert.True(firstPage.GetProperty("lastSequence").GetInt64() > 0);
        var newest = Assert.Single(firstPage.GetProperty("items").EnumerateArray());
        Assert.Equal(secondId.ToString(), newest.GetProperty("id").GetString());
        Assert.Equal("Second", newest.GetProperty("title").GetString());
        Assert.Equal("success", newest.GetProperty("tone").GetString());
        Assert.Equal("dev.stellarr.notifications", newest.GetProperty("source").GetProperty("packageId").GetString());
        Assert.Equal(TestData.GeneralChannelId.ToString(), newest.GetProperty("target").GetProperty("channelId").GetString());
        var cursor = firstPage.GetProperty("nextBeforeSequence").GetInt64();

        var secondPage = await ada.GetFromJsonAsync<JsonElement>(
            $"/api/notifications?limit=1&beforeSequence={cursor}");
        var oldest = Assert.Single(secondPage.GetProperty("items").EnumerateArray());
        Assert.Equal(firstId.ToString(), oldest.GetProperty("id").GetString());
        Assert.Equal(JsonValueKind.Null, secondPage.GetProperty("nextBeforeSequence").ValueKind);
        Assert.DoesNotContain(
            firstPage.GetProperty("items").EnumerateArray().Concat(secondPage.GetProperty("items").EnumerateArray()),
            item => item.GetProperty("id").GetString() == otherUserId.ToString());

        var read = await ada.PutAsync($"/api/notifications/{secondId}/read", content: null);
        read.EnsureSuccessStatusCode();
        using (var readJson = JsonDocument.Parse(await read.Content.ReadAsStringAsync()))
            Assert.NotEqual(JsonValueKind.Null, readJson.RootElement.GetProperty("readAt").ValueKind);
        Assert.Equal(1, (await ada.GetFromJsonAsync<JsonElement>("/api/notifications"))
            .GetProperty("unreadCount").GetInt32());

        var readAll = await ada.PostAsync("/api/notifications/read-all", content: null);
        readAll.EnsureSuccessStatusCode();
        Assert.Equal(1, (await readAll.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("changed").GetInt32());
        Assert.Equal(0, (await ada.GetFromJsonAsync<JsonElement>("/api/notifications"))
            .GetProperty("unreadCount").GetInt32());

        var forbiddenDelete = await ada.DeleteAsync($"/api/notifications/{otherUserId}");
        Assert.Equal(HttpStatusCode.NotFound, forbiddenDelete.StatusCode);
        var deleted = await ada.DeleteAsync($"/api/notifications/{firstId}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        var remaining = await ada.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.DoesNotContain(
            remaining.GetProperty("items").EnumerateArray(),
            item => item.GetProperty("id").GetString() == firstId.ToString());
    }

    [Fact]
    public async Task InboxRejectsAnonymousAndInvalidPaginationRequests()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var anonymous = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/notifications")).StatusCode);

        using var member = await AuthenticatedClientAsync(factory, "ilya", "Meteor!2026");
        Assert.Equal(HttpStatusCode.BadRequest, (await member.GetAsync("/api/notifications?limit=101")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await member.GetAsync("/api/notifications?beforeSequence=0")).StatusCode);
    }

    [Fact]
    public async Task ChannelMentionCreatesOnePrivateNotificationAndIgnoresCodeUrlsAndEmail()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = await AuthenticatedClientAsync(factory, "maja", "Aurora!2026");
        using var ada = await AuthenticatedClientAsync(factory, "ada", "Quasar!2026");

        var response = await maja.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new
            {
                clientMessageId = Guid.NewGuid(),
                content = "Hej @Ada i ponownie @ada. `@ada` https://example.test/@ada maja@ada",
                attachmentIds = Array.Empty<string>(),
            });
        response.EnsureSuccessStatusCode();

        var inbox = await ada.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Equal(1, inbox.GetProperty("unreadCount").GetInt32());
        var mention = Assert.Single(inbox.GetProperty("items").EnumerateArray());
        Assert.Equal("stellarr.mention", mention.GetProperty("source").GetProperty("packageId").GetString());
        Assert.Equal("Maja", mention.GetProperty("source").GetProperty("moduleName").GetString());
        Assert.Equal(TestData.GeneralChannelId.ToString(), mention.GetProperty("target").GetProperty("channelId").GetString());

        var senderInbox = await maja.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Equal(0, senderInbox.GetProperty("unreadCount").GetInt32());
    }

    private static UserNotification Notification(
        Guid id,
        Guid userId,
        string title,
        DateTime createdAt,
        Guid? channelId = null) => new()
    {
        Id = id,
        ServerId = TestData.ServerId,
        UserId = userId,
        Source = "sdk",
        SourcePackageId = "dev.stellarr.notifications",
        SourcePackageName = "Notifications",
        SourceModuleId = "alerts",
        SourceModuleName = "Alerts",
        Title = title,
        Body = $"Body for {title}",
        Tone = "success",
        TargetChannelId = channelId,
        CreatedAt = createdAt,
    };

    private static async Task<HttpClient> AuthenticatedClientAsync(
        StellarrWebApplicationFactory factory,
        string username,
        string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        login.EnsureSuccessStatusCode();
        return client;
    }
}
