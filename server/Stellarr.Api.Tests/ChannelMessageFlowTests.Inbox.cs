using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>Mentions in a sent message, and how the inbox they land in treats invitations.</summary>
public sealed partial class ChannelMessageFlowTests
{
    [Fact]
    public async Task AMentionNotifiesMembersOfTheServerOnceAndNeverTheAuthor()
    {
        User outsider;
        await using (var scope = factory.OpenScope(out var db))
        {
            outsider = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        }

        using var author = await SignInAsync("maja");
        using var member = await SignInAsync("nils");
        var content = $"@nils @maja @{outsider.Username} @nobody-here";
        var request = new { content, clientMessageId = Guid.NewGuid() };
        var path = $"/api/channels/{TestData.ProjectsChannelId}/messages";

        Assert.Equal(HttpStatusCode.Created, (await author.PostAsJsonAsync(path, request)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await author.PostAsJsonAsync(path, request)).StatusCode);

        var mention = Assert.Single(await MentionsAsync(member));
        Assert.Equal("Maja mentioned you", mention.GetProperty("title").GetString());
        Assert.Equal(content, mention.GetProperty("body").GetString());
        Assert.Equal("info", mention.GetProperty("tone").GetString());
        Assert.Equal("system", mention.GetProperty("source").GetProperty("type").GetString());
        Assert.Equal(
            TestData.ProjectsChannelId.ToString(),
            mention.GetProperty("target").GetProperty("channelId").GetString());
        Assert.Empty(await MentionsAsync(author));
        await using var verification = factory.OpenScope(out var verificationDb);
        Assert.False(await verificationDb.UserNotifications.AnyAsync(x => x.UserId == outsider.Id));
    }

    [Fact]
    public async Task AMentionIsAnnouncedToTheMentionedMembersConnectionsOnly()
    {
        using var author = await SignInAsync("maja");
        using var member = await SignInAsync("ilya");
        await using var mentioned = await ListenAsync("ilya", "NotificationInboxChanged");
        await using var bystander = await ListenAsync("jo", "NotificationInboxChanged");

        (await PostAsync(author, TestData.ProjectsChannelId, "@ilya zajrzyj tu")).EnsureSuccessStatusCode();
        // The bystander's own event follows anything wrongly sent to them before it.
        (await PostAsync(author, TestData.ProjectsChannelId, "@jo ty też")).EnsureSuccessStatusCode();

        var announced = await mentioned.Next("NotificationInboxChanged");
        var listed = (await member.GetFromJsonAsync<JsonElement>("/api/notifications"))
            .GetProperty("items")[0];
        Assert.Equal(TestData.ServerId.ToString(), announced.GetProperty("serverId").GetString());
        Assert.Equal(listed.GetProperty("sequence").GetInt64(), announced.GetProperty("sequence").GetInt64());
        Assert.False(announced.GetProperty("global").GetBoolean());
        Assert.Equal(
            TestData.ServerId.ToString(),
            (await bystander.Next("NotificationInboxChanged")).GetProperty("serverId").GetString());
        Assert.Equal(0, mentioned.Pending("NotificationInboxChanged"));
        Assert.Equal(0, bystander.Pending("NotificationInboxChanged"));
    }

    [Fact]
    public async Task InvitationsAreShownWhileTheirInviteCanStillBeUsed()
    {
        var recipient = Accounts["ada"].Id;
        var usable = await AddInvitationAsync(recipient, "open");
        var expired = await AddInvitationAsync(recipient, "expired", expiresAt: DateTime.UtcNow.AddMinutes(-1));
        var spent = await AddInvitationAsync(recipient, "spent", uses: 1, maxUses: 1);
        var someoneElses = await AddInvitationAsync(Accounts["jo"].Id, "private");
        using var client = await SignInAsync("ada");

        var inbox = await client.GetFromJsonAsync<JsonElement>("/api/notifications?limit=100");

        var ids = inbox.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("id").GetString()).ToArray();
        Assert.Contains(usable.Id.ToString(), ids);
        Assert.DoesNotContain(expired.Id.ToString(), ids);
        Assert.DoesNotContain(spent.Id.ToString(), ids);
        Assert.DoesNotContain(someoneElses.Id.ToString(), ids);
        var target = inbox.GetProperty("items").EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == usable.Id.ToString())
            .GetProperty("target");
        Assert.Equal("server-invite", target.GetProperty("type").GetString());
        Assert.Equal(usable.TargetInviteCode, target.GetProperty("inviteCode").GetString());
        Assert.Equal(usable.ServerId.ToString(), target.GetProperty("serverId").GetString());
        Assert.Equal("Obcy", target.GetProperty("serverName").GetString());
        Assert.Equal("Maja", target.GetProperty("invitedByName").GetString());
    }

    [Fact]
    public async Task AnInvitationThatCanNoLongerBeUsedCanStillBeReadAndDismissed()
    {
        var expired = await AddInvitationAsync(Accounts["ilya"].Id, "lapsed", expiresAt: DateTime.UtcNow.AddMinutes(-1));
        var dismissed = await AddInvitationAsync(Accounts["ilya"].Id, "gone", expiresAt: DateTime.UtcNow.AddMinutes(-1));
        using var client = await SignInAsync("ilya");
        await using var connection = await ListenAsync("ilya", "NotificationInboxChanged");

        var read = await client.PutAsync($"/api/notifications/{expired.Id}/read", content: null);
        var delete = await client.DeleteAsync($"/api/notifications/{dismissed.Id}");

        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.NotEqual(
            JsonValueKind.Null,
            (await read.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("readAt").ValueKind);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        // An invitation concerns more than the server being looked at.
        Assert.True((await connection.Next("NotificationInboxChanged")).GetProperty("global").GetBoolean());
        Assert.True((await connection.Next("NotificationInboxChanged")).GetProperty("global").GetBoolean());
    }

    [Fact]
    public async Task MarkingEverythingReadTouchesOnlyWhatTheInboxShows()
    {
        var shown = await AddInvitationAsync(Accounts["nils"].Id, "visible");
        var hidden = await AddInvitationAsync(Accounts["nils"].Id, "hidden", expiresAt: DateTime.UtcNow.AddMinutes(-1));
        using var client = await SignInAsync("nils");

        var response = await client.PostAsync("/api/notifications/read-all", content: null);

        response.EnsureSuccessStatusCode();
        Assert.True((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("changed").GetInt32() >= 1);
        await using var scope = factory.OpenScope(out var db);
        Assert.NotNull((await db.UserNotifications.SingleAsync(x => x.Id == shown.Id)).ReadAt);
        Assert.Null((await db.UserNotifications.SingleAsync(x => x.Id == hidden.Id)).ReadAt);
    }

    [Fact]
    public async Task TheInboxIsNeverCachedWhateverTheAnswer()
    {
        using var client = await SignInAsync("jo");

        foreach (var url in new[]
        {
            "/api/notifications",
            "/api/notifications?limit=0",
            $"/api/notifications/{Guid.NewGuid()}/read",
        })
        {
            using var request = new HttpRequestMessage(url.EndsWith("/read", StringComparison.Ordinal) ? HttpMethod.Put : HttpMethod.Get, url);
            using var response = await client.SendAsync(request);
            Assert.True(response.Headers.CacheControl?.NoStore, url);
        }
    }

    private static async Task<JsonElement[]> MentionsAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<JsonElement>("/api/notifications?limit=100"))
            .GetProperty("items").EnumerateArray()
            .Where(x => x.GetProperty("source").GetProperty("packageId").GetString() == "stellarr.mention")
            .ToArray();

    /// <summary>An invitation of a server the recipient is not in, with the invite it points at.</summary>
    private async Task<UserNotification> AddInvitationAsync(
        Guid recipientId,
        string code,
        DateTime? expiresAt = null,
        int uses = 0,
        int? maxUses = null)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = new StellarrServer { Id = Guid.NewGuid(), Name = "Obcy", CreatedAt = DateTime.UtcNow };
        db.Servers.Add(server);
        var invite = new ServerInvite
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            CreatedById = Accounts["maja"].Id,
            Code = $"{code}-{Guid.NewGuid():N}"[..32],
            ExpiresAt = expiresAt,
            Uses = uses,
            MaxUses = maxUses,
            CreatedAt = DateTime.UtcNow,
        };
        db.ServerInvites.Add(invite);
        var notification = new UserNotification
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            UserId = recipientId,
            Source = "system",
            SourcePackageId = "stellarr.invite",
            SourcePackageName = server.Name,
            SourceModuleId = "invite",
            SourceModuleName = "Maja",
            Title = "Zaproszenie",
            Body = "",
            Tone = "info",
            TargetInviteCode = invite.Code,
            CreatedAt = DateTime.UtcNow,
        };
        db.UserNotifications.Add(notification);
        await db.SaveChangesAsync();
        return notification;
    }
}
