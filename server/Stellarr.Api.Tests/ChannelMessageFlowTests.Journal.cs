using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>The journal clients replay to catch up after a dropped connection.</summary>
public sealed partial class ChannelMessageFlowTests
{
    [Fact]
    public async Task SyncAnswersAnUpsertAfterASendAndAnEditAndADeleteAfterARemoval()
    {
        using var client = await SignInAsync("nils");
        var cursor = await SyncCursorAsync(client, TestData.GeneralChannelId);

        var sent = await SendAsync(client, TestData.GeneralChannelId, "przerwa w sieci");
        var messageId = sent.GetProperty("id").GetString();
        var afterSend = await SyncAsync(client, TestData.GeneralChannelId, cursor);
        var upsert = Assert.Single(afterSend.GetProperty("changes").EnumerateArray());
        Assert.Equal("upsert", upsert.GetProperty("kind").GetString());
        Assert.Equal(messageId, upsert.GetProperty("messageId").GetString());
        Assert.Equal("przerwa w sieci", upsert.GetProperty("message").GetProperty("content").GetString());
        Assert.False(afterSend.GetProperty("hasMore").GetBoolean());
        Assert.False(afterSend.GetProperty("resetRequired").GetBoolean());
        cursor = afterSend.GetProperty("nextCursor").GetString()!;
        Assert.Equal(upsert.GetProperty("cursor").GetString(), cursor);

        (await client.PatchAsJsonAsync($"/api/messages/{messageId}", new { content = "poprawione" }))
            .EnsureSuccessStatusCode();
        var afterEdit = await SyncAsync(client, TestData.GeneralChannelId, cursor);
        var edited = Assert.Single(afterEdit.GetProperty("changes").EnumerateArray());
        Assert.Equal("upsert", edited.GetProperty("kind").GetString());
        Assert.Equal("poprawione", edited.GetProperty("message").GetProperty("content").GetString());
        cursor = afterEdit.GetProperty("nextCursor").GetString()!;

        (await client.DeleteAsync($"/api/messages/{messageId}")).EnsureSuccessStatusCode();
        var afterDelete = await SyncAsync(client, TestData.GeneralChannelId, cursor);
        var removed = Assert.Single(afterDelete.GetProperty("changes").EnumerateArray());
        Assert.Equal("delete", removed.GetProperty("kind").GetString());
        Assert.Equal(messageId, removed.GetProperty("messageId").GetString());
        Assert.Equal(JsonValueKind.Null, removed.GetProperty("message").ValueKind);
    }

    [Fact]
    public async Task AnEditThatChangesNothingLeavesNoTraceInTheJournal()
    {
        using var client = await SignInAsync("nils");
        var sent = await SendAsync(client, TestData.GeneralChannelId, "bez zmian");
        var cursor = await SyncCursorAsync(client, TestData.GeneralChannelId);

        (await client.PatchAsJsonAsync($"/api/messages/{sent.GetProperty("id").GetString()}", new { content = "bez zmian" }))
            .EnsureSuccessStatusCode();

        var page = await SyncAsync(client, TestData.GeneralChannelId, cursor);
        Assert.Empty(page.GetProperty("changes").EnumerateArray());
        Assert.Equal(cursor, page.GetProperty("nextCursor").GetString());
    }

    [Fact]
    public async Task HistoryStartsTheJournalAtTheLatestChangeOfItsOwnChannel()
    {
        using var client = await SignInAsync("ilya");
        var sent = await SendAsync(client, TestData.ProjectsChannelId, "w projektach");
        var projects = await SyncCursorAsync(client, TestData.ProjectsChannelId);

        await SendAsync(client, TestData.GeneralChannelId, "w ogólnym");

        Assert.Equal(projects, await SyncCursorAsync(client, TestData.ProjectsChannelId));
        var replay = await SyncAsync(client, TestData.ProjectsChannelId, projects);
        Assert.Empty(replay.GetProperty("changes").EnumerateArray());
        var missed = await SyncAsync(client, TestData.ProjectsChannelId, "0");
        Assert.Contains(
            missed.GetProperty("changes").EnumerateArray(),
            x => x.GetProperty("messageId").GetString() == sent.GetProperty("id").GetString());
    }

    [Fact]
    public async Task SyncPagesByLimitAndResumesFromTheNextCursor()
    {
        using var client = await SignInAsync("jo");
        var cursor = await SyncCursorAsync(client, TestData.ProjectsChannelId);
        var ids = new List<string?>();
        for (var i = 0; i < 3; i++)
        {
            ids.Add((await SendAsync(client, TestData.ProjectsChannelId, $"wiadomość {i}")).GetProperty("id").GetString());
        }

        var first = await SyncAsync(client, TestData.ProjectsChannelId, cursor, limit: 2);
        var second = await SyncAsync(
            client, TestData.ProjectsChannelId, first.GetProperty("nextCursor").GetString()!, limit: 2);

        Assert.True(first.GetProperty("hasMore").GetBoolean());
        Assert.False(second.GetProperty("hasMore").GetBoolean());
        Assert.Equal(
            ids,
            first.GetProperty("changes").EnumerateArray().Concat(second.GetProperty("changes").EnumerateArray())
                .Select(x => x.GetProperty("messageId").GetString()));
    }

    [Fact]
    public async Task ACompactedJournalAsksTheClientToLoadTheHistoryAgain()
    {
        using var client = await SignInAsync("jo");
        var cursor = await SyncCursorAsync(client, TestData.MemesChannelId);
        await using (var scope = factory.OpenScope(out var db))
        {
            db.MessageChanges.Add(new MessageChange
            {
                ChannelId = TestData.MemesChannelId,
                MessageId = Guid.Empty,
                Kind = MessageChangeKind.Reset,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var page = await SyncAsync(client, TestData.MemesChannelId, cursor);

        Assert.True(page.GetProperty("resetRequired").GetBoolean());
    }

    [Fact]
    public async Task SyncRefusesBadPositionsAndChannelsThatAreNotTextChannelsOfTheServer()
    {
        using var client = await SignInAsync("jo");
        using var anonymous = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = false,
        });
        var path = $"/api/channels/{TestData.GeneralChannelId}/messages/sync";

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{path}?after=-1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{path}?limit=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{path}?limit=501")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/channels/{TestData.VoiceChannelId}/messages/sync")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/channels/{Guid.NewGuid()}/messages/sync")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
    }

    [Fact]
    public async Task UpgradeRebuildsTheColumnsAndJournalOfAnOlderDatabase()
    {
        using var ownFactory = new StellarrWebApplicationFactory();
        using var client = ownFactory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "ada", password = "Quasar!2026" }))
            .EnsureSuccessStatusCode();
        await using (var scope = ownFactory.OpenScope(out var db))
        {
            await db.Database.ExecuteSqlRawAsync(
                """
                DROP TRIGGER "Messages_Changes_AfterInsert";
                DROP TRIGGER "Messages_Changes_AfterUpdate";
                DROP TRIGGER "Messages_Changes_AfterDelete";
                DROP TRIGGER "Channels_Changes_AfterDelete";
                DROP TABLE "MessageChanges";
                DROP INDEX "IX_Messages_ChannelId_PinnedAt";
                ALTER TABLE "Messages" DROP COLUMN "EditedAt";
                ALTER TABLE "Messages" DROP COLUMN "PinnedAt";
                ALTER TABLE "Messages" DROP COLUMN "IsSystem";
                """);

            await Stellarr.Api.Data.DatabaseSchema.UpgradeAsync(db, default);
        }

        var cursor = await SyncCursorAsync(client, TestData.GeneralChannelId);
        var sent = await SendAsync(client, TestData.GeneralChannelId, "po aktualizacji");
        (await client.PatchAsJsonAsync($"/api/messages/{sent.GetProperty("id").GetString()}", new { content = "zmiana" }))
            .EnsureSuccessStatusCode();

        var page = await SyncAsync(client, TestData.GeneralChannelId, cursor);
        Assert.Equal(2, page.GetProperty("changes").GetArrayLength());
        Assert.All(
            page.GetProperty("changes").EnumerateArray(),
            x => Assert.Equal("upsert", x.GetProperty("kind").GetString()));
    }

    private static async Task<string> SyncCursorAsync(HttpClient client, Guid channelId) =>
        (await client.GetFromJsonAsync<JsonElement>($"/api/channels/{channelId}/messages?limit=1"))
            .GetProperty("syncCursor").GetString()!;

    private static async Task<JsonElement> SyncAsync(HttpClient client, Guid channelId, string after, int? limit = null) =>
        await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{channelId}/messages/sync?after={after}" + (limit is null ? "" : $"&limit={limit}"));
}
