using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// Who may rewrite, remove and answer channel messages, how a retried send is
/// recognised, and where a person's read marker goes.
/// </summary>
public sealed partial class ChannelMessageFlowTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Dictionary<string, (Guid Id, string Password)> Accounts = new()
    {
        ["maja"] = (Guid.Parse("30000000-0000-0000-0000-000000000001"), "Aurora!2026"),
        ["ada"] = (Guid.Parse("30000000-0000-0000-0000-000000000002"), "Quasar!2026"),
        ["ilya"] = (Guid.Parse("30000000-0000-0000-0000-000000000003"), "Meteor!2026"),
        ["nils"] = (Guid.Parse("30000000-0000-0000-0000-000000000004"), "Zenith!2026"),
        ["jo"] = (Guid.Parse("30000000-0000-0000-0000-000000000005"), "Corona!2026"),
    };

    [Fact]
    public async Task AuthorRewritesAMessageAndTheServerIsToldWithoutViewerState()
    {
        using var author = await SignInAsync("nils");
        var message = await SendAsync(author, TestData.GeneralChannelId, "pierwsza wersja");
        await using var observer = await ListenAsync("jo", "MessageUpdated");

        var edit = await author.PatchAsJsonAsync(
            $"/api/messages/{message.GetProperty("id").GetString()}",
            new { content = "  druga wersja  " });

        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        var edited = await edit.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("druga wersja", edited.GetProperty("content").GetString());
        Assert.Equal(JsonValueKind.String, edited.GetProperty("editedAt").ValueKind);
        var announced = await observer.Next("MessageUpdated");
        Assert.Equal(message.GetProperty("id").GetString(), announced.GetProperty("id").GetString());
        Assert.Equal("druga wersja", announced.GetProperty("content").GetString());
    }

    [Fact]
    public async Task SavingTheSameTextDoesNotMarkTheMessageEdited()
    {
        using var author = await SignInAsync("nils");
        var message = await SendAsync(author, TestData.GeneralChannelId, "bez zmian");

        var edit = await author.PatchAsJsonAsync(
            $"/api/messages/{message.GetProperty("id").GetString()}",
            new { content = "bez zmian" });

        edit.EnsureSuccessStatusCode();
        Assert.Equal(
            JsonValueKind.Null,
            (await edit.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("editedAt").ValueKind);
    }

    [Fact]
    public async Task OnlyTheAuthorMayRewriteAMessageModeratorsIncluded()
    {
        using var author = await SignInAsync("jo");
        var messageId = (await SendAsync(author, TestData.GeneralChannelId, "moje słowa")).GetProperty("id").GetString();

        foreach (var name in new[] { "ada", "maja", "ilya" })
        {
            using var other = await SignInAsync(name);
            Assert.Equal(
                HttpStatusCode.NotFound,
                (await other.PatchAsJsonAsync($"/api/messages/{messageId}", new { content = "cudze słowa" })).StatusCode);
        }

        Assert.Equal("moje słowa", (await StoredAsync(Guid.Parse(messageId!)))?.Content);
    }

    [Fact]
    public async Task AnInvalidRewriteIsRefusedBeforeTheMessageIsLookedUp()
    {
        using var client = await SignInAsync("nils");
        var unknown = Guid.NewGuid();

        foreach (var content in new[] { null, "   ", new string('x', MessageLimits.MaxContentLength + 1) })
        {
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await client.PatchAsJsonAsync($"/api/messages/{unknown}", new { content })).StatusCode);
        }

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PatchAsJsonAsync($"/api/messages/{unknown}", new { content = "tekst" })).StatusCode);
    }

    [Fact]
    public async Task AuthorAndModeratorMayDeleteButAnotherMemberMayNot()
    {
        using var author = await SignInAsync("jo");
        using var moderator = await SignInAsync("ada");
        using var member = await SignInAsync("ilya");
        var own = Guid.Parse((await SendAsync(author, TestData.GeneralChannelId, "do usunięcia")).GetProperty("id").GetString()!);
        var moderated = Guid.Parse((await SendAsync(author, TestData.GeneralChannelId, "do moderacji")).GetProperty("id").GetString()!);
        await using var observer = await ListenAsync("nils", "MessageDeleted");

        Assert.Equal(HttpStatusCode.NotFound, (await member.DeleteAsync($"/api/messages/{moderated}")).StatusCode);
        Assert.NotNull(await StoredAsync(moderated));

        Assert.Equal(HttpStatusCode.NoContent, (await moderator.DeleteAsync($"/api/messages/{moderated}")).StatusCode);
        Assert.Null(await StoredAsync(moderated));
        var announced = await observer.Next("MessageDeleted");
        Assert.Equal(moderated.ToString(), announced.GetProperty("messageId").GetString());
        Assert.Equal(TestData.GeneralChannelId.ToString(), announced.GetProperty("channelId").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await author.DeleteAsync($"/api/messages/{own}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await author.DeleteAsync($"/api/messages/{own}")).StatusCode);
    }

    [Fact]
    public async Task ServerNoticesCannotBeRewrittenOrRemovedByAnyone()
    {
        var notice = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = TestData.GeneralChannelId,
            AuthorId = Accounts["jo"].Id,
            IsSystem = true,
            Content = "Jo dołączył do serwera",
            CreatedAt = DateTime.UtcNow,
        };
        await using (var scope = factory.OpenScope(out var db))
        {
            db.Messages.Add(notice);
            await db.SaveChangesAsync();
        }

        foreach (var name in new[] { "jo", "ada", "maja" })
        {
            using var client = await SignInAsync(name);
            Assert.Equal(
                HttpStatusCode.NotFound,
                (await client.PatchAsJsonAsync($"/api/messages/{notice.Id}", new { content = "podmiana" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/messages/{notice.Id}")).StatusCode);
        }

        Assert.Equal(notice.Content, (await StoredAsync(notice.Id))?.Content);
    }

    [Fact]
    public async Task AMessageOfAnotherServerIsOutOfReach()
    {
        var elsewhere = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = Guid.NewGuid(),
            AuthorId = Accounts["jo"].Id,
            Content = "gdzie indziej",
            CreatedAt = DateTime.UtcNow,
        };
        await using (var scope = factory.OpenScope(out var db))
        {
            var otherServer = new StellarrServer { Id = Guid.NewGuid(), Name = "Obcy", CreatedAt = DateTime.UtcNow };
            db.Servers.Add(otherServer);
            db.Channels.Add(new Channel
            {
                Id = elsewhere.ChannelId,
                ServerId = otherServer.Id,
                Name = "ogólny",
                Kind = ChannelKind.Text,
            });
            db.Messages.Add(elsewhere);
            await db.SaveChangesAsync();
        }

        using var author = await SignInAsync("jo");
        using var owner = await SignInAsync("maja");

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await author.PatchAsJsonAsync($"/api/messages/{elsewhere.Id}", new { content = "zmiana" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await author.DeleteAsync($"/api/messages/{elsewhere.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/messages/{elsewhere.Id}")).StatusCode);
        Assert.NotNull(await StoredAsync(elsewhere.Id));
    }

    [Fact]
    public async Task AReplyMustPointIntoTheSameChannel()
    {
        using var client = await SignInAsync("ilya");
        var original = await SendAsync(client, TestData.GeneralChannelId, "pytanie");
        var originalId = original.GetProperty("id").GetString();

        var elsewhere = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.ProjectsChannelId}/messages",
            new { content = "odpowiedź", replyToMessageId = originalId });
        var unknown = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content = "odpowiedź", replyToMessageId = Guid.NewGuid() });
        var reply = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content = "odpowiedź", replyToMessageId = originalId });

        Assert.Equal(HttpStatusCode.BadRequest, elsewhere.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Created, reply.StatusCode);
        var quoted = (await reply.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("replyTo");
        Assert.Equal(originalId, quoted.GetProperty("id").GetString());
        Assert.Equal("pytanie", quoted.GetProperty("preview").GetString());
    }

    [Fact]
    public async Task AttachmentsMustBeTheSendersOwnAndAVoiceMessageTravelsAlone()
    {
        var jo = Accounts["jo"].Id;
        var voice = Upload(jo, voice: true);
        var file = Upload(jo, voice: false);
        var foreign = Upload(Accounts["ilya"].Id, voice: false);
        await using (var scope = factory.OpenScope(out var db))
        {
            db.ImageAttachments.AddRange(voice, file, foreign);
            await db.SaveChangesAsync();
        }

        using var client = await SignInAsync("jo");
        Task<HttpResponseMessage> Send(string content, params Guid[] attachmentIds) => client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content, attachmentIds });

        Assert.Equal(HttpStatusCode.BadRequest, (await Send("", foreign.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send("", voice.Id, file.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send("z podpisem", voice.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Send("", voice.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Send("plik", file.Id)).StatusCode);
    }

    [Fact]
    public async Task SlowModeHoldsBackMembersButNotThoseWhoManageChannels()
    {
        await SetSlowModeAsync(TestData.MemesChannelId, 3600);
        using var member = await SignInAsync("jo");
        using var owner = await SignInAsync("maja");

        Assert.Equal(HttpStatusCode.Created, (await PostAsync(member, TestData.MemesChannelId, "pierwsza")).StatusCode);
        var held = await PostAsync(member, TestData.MemesChannelId, "druga");

        Assert.Equal(HttpStatusCode.TooManyRequests, held.StatusCode);
        Assert.InRange(held.Headers.RetryAfter?.Delta?.TotalSeconds ?? 0, 1, 3600);
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(owner, TestData.MemesChannelId, "pierwsza")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(owner, TestData.MemesChannelId, "druga")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(member, TestData.GeneralChannelId, "gdzie indziej")).StatusCode);
    }

    [Fact]
    public async Task ARetriedSendIsRecognisedBeforeSlowModeCanRefuseIt()
    {
        await SetSlowModeAsync(TestData.MemesChannelId, 3600);
        using var client = await SignInAsync("nils");
        var payload = new { content = "raz", clientMessageId = Guid.NewGuid() };
        var path = $"/api/channels/{TestData.MemesChannelId}/messages";

        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(path, payload)).StatusCode);
        var retry = await client.PostAsJsonAsync(path, payload);

        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(
            payload.clientMessageId.ToString(),
            (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            (await client.PostAsJsonAsync(path, new { content = "dwa", clientMessageId = Guid.NewGuid() })).StatusCode);
    }

    [Fact]
    public async Task ClientMessageIdMakesASendIdempotentUntilTheContentDiffers()
    {
        using var author = await SignInAsync("ilya");
        using var other = await SignInAsync("jo");
        var id = Guid.NewGuid();
        var path = $"/api/channels/{TestData.GeneralChannelId}/messages";

        var first = await author.PostAsJsonAsync(path, new { content = "tylko raz", clientMessageId = id });
        var same = await author.PostAsJsonAsync(path, new { content = "  tylko raz ", clientMessageId = id });
        var changed = await author.PostAsJsonAsync(path, new { content = "inaczej", clientMessageId = id });
        var elsewhere = await author.PostAsJsonAsync(
            $"/api/channels/{TestData.ProjectsChannelId}/messages",
            new { content = "tylko raz", clientMessageId = id });
        var stolen = await other.PostAsJsonAsync(path, new { content = "tylko raz", clientMessageId = id });
        var empty = await author.PostAsJsonAsync(path, new { content = "x", clientMessageId = Guid.Empty });

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, same.StatusCode);
        Assert.Equal(id.ToString(), (await same.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, elsewhere.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stolen.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal("tylko raz", (await StoredAsync(id))?.Content);
    }

    [Fact]
    public async Task SendsRacingWithOneClientMessageIdStoreTheMessageOnce()
    {
        using var client = await SignInAsync("maja");
        var id = Guid.NewGuid();

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content = "wyścig", clientMessageId = id })));

        Assert.All(responses, x => Assert.True(x.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK));
        Assert.Equal(1, responses.Count(x => x.StatusCode == HttpStatusCode.Created));
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.Messages.CountAsync(x => x.Id == id));
    }

    [Fact]
    public async Task ReadMarkerNeverMovesBackwards()
    {
        using var client = await SignInAsync("nils");
        var channelId = TestData.ProjectsChannelId;
        var userId = Accounts["nils"].Id;
        var before = DateTime.UtcNow;

        var first = await client.PutAsync($"/api/channels/{channelId}/read", content: null);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var body = await first.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(channelId.ToString(), body.GetProperty("channelId").GetString());
        Assert.InRange(body.GetProperty("lastReadAt").GetDateTime().ToUniversalTime(), before.AddSeconds(-1), DateTime.UtcNow);

        var later = DateTime.UtcNow.AddHours(1);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.ChannelReads.Where(x => x.ChannelId == channelId && x.UserId == userId)
                .ExecuteUpdateAsync(x => x.SetProperty(read => read.LastReadAt, later));
        }

        (await client.PutAsync($"/api/channels/{channelId}/read", content: null)).EnsureSuccessStatusCode();

        await using var verification = factory.OpenScope(out var verificationDb);
        var stored = await verificationDb.ChannelReads.AsNoTracking()
            .SingleAsync(x => x.ChannelId == channelId && x.UserId == userId);
        Assert.Equal(later, stored.LastReadAt);
    }

    [Fact]
    public async Task OnlyATextChannelOfTheServerCanBeMarkedRead()
    {
        using var client = await SignInAsync("nils");
        using var anonymous = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PutAsync($"/api/channels/{TestData.VoiceChannelId}/read", content: null)).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PutAsync($"/api/channels/{Guid.NewGuid()}/read", content: null)).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.PutAsync($"/api/channels/{TestData.GeneralChannelId}/read", content: null)).StatusCode);
    }

    [Fact]
    public async Task ReadChangesReachOnlyTheConnectionsOfTheReader()
    {
        using var reader = await SignInAsync("ilya");
        using var neighbour = await SignInAsync("jo");
        await using var readerEvents = await ListenAsync("ilya", "ChannelReadChanged");
        await using var neighbourEvents = await ListenAsync("jo", "ChannelReadChanged");

        (await reader.PutAsync($"/api/channels/{TestData.ProjectsChannelId}/read", content: null)).EnsureSuccessStatusCode();
        // The neighbour's own event follows anything wrongly sent to them before it.
        (await neighbour.PutAsync($"/api/channels/{TestData.MemesChannelId}/read", content: null)).EnsureSuccessStatusCode();

        Assert.Equal(
            TestData.ProjectsChannelId.ToString(),
            (await readerEvents.Next("ChannelReadChanged")).GetProperty("channelId").GetString());
        Assert.Equal(
            TestData.MemesChannelId.ToString(),
            (await neighbourEvents.Next("ChannelReadChanged")).GetProperty("channelId").GetString());
        Assert.Equal(0, neighbourEvents.Pending("ChannelReadChanged"));
    }

    [Fact]
    public async Task SendingAMessageReadsTheChannelForItsAuthorOnly()
    {
        using var author = await SignInAsync("maja");
        using var reader = await SignInAsync("ada");
        await using var authorEvents = await ListenAsync("maja", "ChannelReadChanged");
        await using var readerEvents = await ListenAsync("ada", "MessageCreated", "ChannelReadChanged");

        var message = await SendAsync(author, TestData.GeneralChannelId, "przeczytane przez autora");
        Assert.Equal(
            message.GetProperty("id").GetString(),
            (await readerEvents.Next("MessageCreated")).GetProperty("id").GetString());
        (await reader.PutAsync($"/api/channels/{TestData.ProjectsChannelId}/read", content: null)).EnsureSuccessStatusCode();

        var marker = await authorEvents.Next("ChannelReadChanged");
        Assert.Equal(TestData.GeneralChannelId.ToString(), marker.GetProperty("channelId").GetString());
        Assert.Equal(
            message.GetProperty("createdAt").GetDateTime().ToUniversalTime(),
            marker.GetProperty("lastReadAt").GetDateTime().ToUniversalTime());
        // The reader's first read event is their own, for the other channel.
        Assert.Equal(
            TestData.ProjectsChannelId.ToString(),
            (await readerEvents.Next("ChannelReadChanged")).GetProperty("channelId").GetString());
        Assert.Equal(0, readerEvents.Pending("ChannelReadChanged"));
    }

    private static ImageAttachment Upload(Guid uploaderId, bool voice) => new()
    {
        Id = Guid.NewGuid(),
        UploadedById = uploaderId,
        ObjectKey = $"uploads/{Guid.NewGuid():N}",
        FileName = voice ? "voice.ogg" : "note.txt",
        ContentType = voice ? "audio/ogg" : "text/plain",
        SizeBytes = 12,
        IsVoiceMessage = voice,
        CreatedAt = DateTime.UtcNow,
    };

    private async Task SetSlowModeAsync(Guid channelId, int seconds)
    {
        await using var scope = factory.OpenScope(out var db);
        await db.Channels.Where(x => x.Id == channelId)
            .ExecuteUpdateAsync(x => x.SetProperty(channel => channel.SlowModeSeconds, seconds));
    }

    private async Task<Message?> StoredAsync(Guid messageId)
    {
        await using var scope = factory.OpenScope(out var db);
        return await db.Messages.AsNoTracking().SingleOrDefaultAsync(x => x.Id == messageId);
    }

    private static Task<HttpResponseMessage> PostAsync(HttpClient client, Guid channelId, string content) =>
        client.PostAsJsonAsync($"/api/channels/{channelId}/messages", new { content });

    private static async Task<JsonElement> SendAsync(HttpClient client, Guid channelId, string content)
    {
        var response = await PostAsync(client, channelId, content);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<HttpClient> SignInAsync(string username)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password = Accounts[username].Password })).EnsureSuccessStatusCode();
        return client;
    }
}
