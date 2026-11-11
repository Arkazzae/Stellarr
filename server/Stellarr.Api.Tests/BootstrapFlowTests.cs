using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Logging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed class BootstrapFlowTests
{
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid IlyaId = Guid.Parse("30000000-0000-0000-0000-000000000003");
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");

    [Fact]
    public async Task AnonymousCallerGetsNoSnapshot()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var anonymous = NewClient(factory);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/bootstrap")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/config/giphy")).StatusCode);
    }

    [Fact]
    public async Task AccountWithoutAMembershipIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using (var scope = factory.OpenScope(out var db))
        {
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                Username = "drifter",
                NormalizedUsername = "DRIFTER",
                DisplayName = "Drifter",
                PasswordHash = scope.ServiceProvider.GetRequiredService<PasswordService>().Hash("Drifting!2026"),
                AvatarColor = "#777777",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        using var client = await SignInAsync(factory, "drifter", "Drifting!2026");

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/bootstrap")).StatusCode);
    }

    [Fact]
    public async Task OwnerReceivesTheWholeSnapshotOfTheirServer()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        Assert.Equal("maja", snapshot.GetProperty("user").GetProperty("username").GetString());
        Assert.Equal("Orbit", snapshot.GetProperty("server").GetProperty("name").GetString());
        Assert.Equal(TestData.ServerId.ToString(), snapshot.GetProperty("server").GetProperty("id").GetString());
        Assert.Equal(
            [TestData.ServerId.ToString()],
            snapshot.GetProperty("servers").EnumerateArray().Select(x => x.GetProperty("id").GetString()));

        var channels = snapshot.GetProperty("channels").EnumerateArray().ToArray();
        Assert.Equal(
            ["ogólny", "projekty", "memy", "Salon", "Nocna zmiana"],
            channels.Select(x => x.GetProperty("name").GetString()));
        Assert.Equal(
            ["text", "text", "text", "voice", "voice"],
            channels.Select(x => x.GetProperty("kind").GetString()));
        Assert.Equal([0, 1, 2, 3, 4], channels.Select(x => x.GetProperty("position").GetInt32()));
        Assert.Equal(0, snapshot.GetProperty("sections").GetArrayLength());

        Assert.Equal(
            ["Ada", "Ilya", "Jo", "Maja", "Nils"],
            snapshot.GetProperty("members").EnumerateArray().Select(x => x.GetProperty("displayName").GetString()));
        Assert.Equal(
            ["manageServer", "manageChannels", "manageRoles", "manageMembers",
                "manageMessages", "moderateMembers", "manageBans", "viewAuditLog"],
            snapshot.GetProperty("permissions").EnumerateArray().Select(x => x.GetString()));

        var message = Assert.Single(snapshot.GetProperty("messages").EnumerateArray());
        Assert.Equal("integration fixture", message.GetProperty("content").GetString());
        Assert.Equal("ada", message.GetProperty("author").GetProperty("username").GetString());
        Assert.Equal(TestData.GeneralChannelId.ToString(), message.GetProperty("channelId").GetString());

        var voice = snapshot.GetProperty("voice");
        Assert.Equal(
            [TestData.VoiceChannelId.ToString(), TestData.NightShiftChannelId.ToString()],
            voice.EnumerateObject().Select(x => x.Name).Order(StringComparer.Ordinal));
        Assert.All(voice.EnumerateObject(), room => Assert.Equal(0, room.Value.GetArrayLength()));
    }

    [Fact]
    public async Task PermissionNamesFollowTheCallersRole()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var moderator = await SignInAsync(factory, "ada", "Quasar!2026");
        using var member = await SignInAsync(factory, "ilya", "Meteor!2026");

        var moderatorSnapshot = await moderator.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        var memberSnapshot = await member.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        Assert.Equal(
            ["manageMessages", "moderateMembers", "manageBans"],
            moderatorSnapshot.GetProperty("permissions").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(0, memberSnapshot.GetProperty("permissions").GetArrayLength());
    }

    [Fact]
    public async Task EveryTextChannelGetsAReadMarkerThatThenStaysPut()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "jo", "Corona!2026");
        var before = DateTime.UtcNow;

        var first = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        var second = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        var markers = first.GetProperty("channelReads");
        Assert.Equal(
            new[] { TestData.GeneralChannelId, TestData.ProjectsChannelId, TestData.MemesChannelId }
                .Select(x => x.ToString()).Order(StringComparer.Ordinal),
            markers.EnumerateObject().Select(x => x.Name).Order(StringComparer.Ordinal));
        Assert.All(markers.EnumerateObject(), marker =>
        {
            Assert.EndsWith("Z", marker.Value.GetString(), StringComparison.Ordinal);
            Assert.True(marker.Value.GetDateTime() >= before.AddSeconds(-1));
        });
        Assert.Equal(markers.GetRawText(), second.GetProperty("channelReads").GetRawText());
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(3, await db.ChannelReads.CountAsync(x => x.UserId == JoId));
    }

    [Fact]
    public async Task ExistingReadMarkerIsReportedAsItWas()
    {
        using var factory = new StellarrWebApplicationFactory();
        var readAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        await using (var scope = factory.OpenScope(out var db))
        {
            db.ChannelReads.Add(new ChannelRead { ChannelId = TestData.ProjectsChannelId, UserId = IlyaId, LastReadAt = readAt });
            await db.SaveChangesAsync();
        }

        using var client = await SignInAsync(factory, "ilya", "Meteor!2026");
        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        var markers = snapshot.GetProperty("channelReads");
        Assert.Equal(readAt, markers.GetProperty(TestData.ProjectsChannelId.ToString()).GetDateTime());
        Assert.Equal(3, markers.EnumerateObject().Count());
    }

    [Fact]
    public async Task BootstrapThatLosesTheRaceForTheReadMarkersStillAnswersWithTheStoredOnes()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"stellarr-tests-{Guid.NewGuid():N}.db");
        var otherTabMarkedAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        var otherTab = new BootstrapInAnotherTab(databasePath, JoId, TestData.GeneralChannelId, otherTabMarkedAt);
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            databasePath: databasePath,
            configureServices: services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.RemoveAll<AppDbContext>();
                services.AddDbContext<AppDbContext>(options =>
                    options.UseSqlite($"Data Source={databasePath}").AddInterceptors(otherTab));
            });
        using var client = await SignInAsync(factory, "jo", "Corona!2026");
        var before = DateTime.UtcNow;

        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        var markers = snapshot.GetProperty("channelReads");
        Assert.Equal(3, markers.EnumerateObject().Count());
        Assert.Equal(otherTabMarkedAt, markers.GetProperty(TestData.GeneralChannelId.ToString()).GetDateTime());
        Assert.True(markers.GetProperty(TestData.ProjectsChannelId.ToString()).GetDateTime() >= before.AddSeconds(-1));
        await using var scope = factory.OpenScope(out var db);
        var stored = await db.ChannelReads.Where(x => x.UserId == JoId)
            .ToDictionaryAsync(x => x.ChannelId.ToString(), x => x.LastReadAt);
        Assert.Equal(
            stored.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key),
            markers.EnumerateObject().Select(x => x.Name).Order(StringComparer.Ordinal));
        Assert.All(markers.EnumerateObject(), marker =>
            Assert.Equal(stored[marker.Name].Ticks, marker.Value.GetDateTime().ToUniversalTime().Ticks));
    }

    [Fact]
    public async Task ServerHeaderOrQuerySelectsAmongTheCallersMemberships()
    {
        using var factory = new StellarrWebApplicationFactory();
        var other = await AddServerAsync(factory, "Drugi", MajaId);
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        var byDefault = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        var byHeader = await GetWithServerAsync(client, "/api/bootstrap", other.ServerId.ToString());
        var byQuery = await client.GetFromJsonAsync<JsonElement>($"/api/bootstrap?serverId={other.ServerId}");

        Assert.Equal("Orbit", byDefault.GetProperty("server").GetProperty("name").GetString());
        foreach (var snapshot in new[] { byHeader, byQuery })
        {
            Assert.Equal("Drugi", snapshot.GetProperty("server").GetProperty("name").GetString());
            Assert.Equal(
                ["Drugi-ogólny"],
                snapshot.GetProperty("channels").EnumerateArray().Select(x => x.GetProperty("name").GetString()));
            Assert.Equal(
                ["Maja"],
                snapshot.GetProperty("members").EnumerateArray().Select(x => x.GetProperty("displayName").GetString()));
            Assert.Equal(["manageMessages"], snapshot.GetProperty("permissions").EnumerateArray().Select(x => x.GetString()));
            Assert.Equal(["Orbit", "Drugi"], snapshot.GetProperty("servers").EnumerateArray().Select(x => x.GetProperty("name").GetString()));
            Assert.Equal(
                [other.ChannelId.ToString()],
                snapshot.GetProperty("channelReads").EnumerateObject().Select(x => x.Name));
        }
    }

    [Fact]
    public async Task AccountThatOnlyBelongsToAnotherServerLandsThere()
    {
        using var factory = new StellarrWebApplicationFactory();
        var other = await AddServerAsync(factory, "Drugi", IlyaId);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.ServerMembers.Where(x => x.UserId == IlyaId && x.ServerId == TestData.ServerId).ExecuteDeleteAsync();
        }

        using var client = await SignInAsync(factory, "ilya", "Meteor!2026");
        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        Assert.Equal(other.ServerId.ToString(), snapshot.GetProperty("server").GetProperty("id").GetString());
    }

    [Fact]
    public async Task UnparsableOrForeignServerSelectionIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory();
        var other = await AddServerAsync(factory, "Drugi", MajaId);
        using var client = await SignInAsync(factory, "ilya", "Meteor!2026");

        using var malformed = await SendWithServerAsync(client, "/api/bootstrap", "not-a-guid");
        using var foreign = await SendWithServerAsync(client, "/api/bootstrap", other.ServerId.ToString());
        using var unknown = await SendWithServerAsync(client, "/api/bootstrap", Guid.NewGuid().ToString());
        using var malformedQuery = await client.GetAsync("/api/bootstrap?serverId=nope");

        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformedQuery.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, unknown.StatusCode);
    }

    [Fact]
    public async Task FirstTextChannelCarriesItsNewestHundredMessagesOldestFirst()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using (var scope = factory.OpenScope(out var db))
        {
            // After the host started, so that the seeded message is older than all of these.
            var start = DateTime.UtcNow;
            db.Messages.AddRange(Enumerable.Range(1, 105).Select(i => new Message
            {
                Id = Guid.NewGuid(),
                ChannelId = TestData.GeneralChannelId,
                AuthorId = AdaId,
                Content = $"m{i}",
                CreatedAt = start.AddSeconds(i),
            }));
            db.Messages.Add(new Message
            {
                Id = Guid.NewGuid(),
                ChannelId = TestData.ProjectsChannelId,
                AuthorId = AdaId,
                Content = "elsewhere",
                CreatedAt = start.AddSeconds(500),
            });
            await db.SaveChangesAsync();
        }

        using var client = await SignInAsync(factory, "maja", "Aurora!2026");
        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        var contents = snapshot.GetProperty("messages").EnumerateArray()
            .Select(x => x.GetProperty("content").GetString()).ToArray();
        Assert.Equal(Enumerable.Range(6, 100).Select(i => $"m{i}"), contents);
    }

    [Fact]
    public async Task MessagesCarryAttachmentsReactionsEmbedsAndReplyReferences()
    {
        using var factory = new StellarrWebApplicationFactory();
        var now = DateTime.UtcNow;
        var upload = new ImageAttachment
        {
            Id = Guid.NewGuid(),
            UploadedById = AdaId,
            ObjectKey = "uploads/diagram",
            FileName = "diagram.png",
            ContentType = "image/png",
            SizeBytes = 2048,
            Width = 640,
            Height = 480,
            CreatedAt = now,
        };
        var original = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = TestData.GeneralChannelId,
            AuthorId = AdaId,
            Content = "  look\n   at   this  ",
            CreatedAt = now.AddSeconds(1),
        };
        var reply = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = TestData.GeneralChannelId,
            AuthorId = IlyaId,
            Content = "nice",
            CreatedAt = now.AddSeconds(2),
            EditedAt = now.AddSeconds(3),
            PinnedAt = now.AddSeconds(4),
            ReplyToMessageId = original.Id,
        };
        await using (var scope = factory.OpenScope(out var db))
        {
            db.ImageAttachments.Add(upload);
            db.Messages.AddRange(original, reply);
            db.MessageAttachments.Add(new MessageAttachment { MessageId = original.Id, AttachmentId = upload.Id });
            db.MessageEmbeds.Add(new MessageEmbed
            {
                Id = Guid.NewGuid(),
                MessageId = reply.Id,
                Url = "https://example.test/page",
                Kind = EmbedKind.Link,
                Provider = "example.test",
                Domain = "example.test",
                Title = "A page",
                Position = 0,
                CreatedAt = now,
            });
            db.MessageReactions.AddRange(
                new MessageReaction { MessageId = reply.Id, UserId = AdaId, Emoji = "🎉", CreatedAt = now.AddSeconds(5) },
                new MessageReaction { MessageId = reply.Id, UserId = MajaId, Emoji = "👍", CreatedAt = now.AddSeconds(6) },
                new MessageReaction { MessageId = reply.Id, UserId = IlyaId, Emoji = "👍", CreatedAt = now.AddSeconds(7) });
            await db.SaveChangesAsync();
        }

        using var client = await SignInAsync(factory, "maja", "Aurora!2026");
        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        var messages = snapshot.GetProperty("messages").EnumerateArray().ToDictionary(
            x => x.GetProperty("id").GetString()!);
        var shownOriginal = messages[original.Id.ToString()];
        var attachment = Assert.Single(shownOriginal.GetProperty("attachments").EnumerateArray());
        Assert.Equal($"/assets/{upload.Id}", attachment.GetProperty("url").GetString());
        Assert.Equal("diagram.png", attachment.GetProperty("name").GetString());
        Assert.Equal(2048, attachment.GetProperty("size").GetInt64());
        Assert.Equal(JsonValueKind.Null, shownOriginal.GetProperty("editedAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, shownOriginal.GetProperty("replyTo").ValueKind);

        var shownReply = messages[reply.Id.ToString()];
        Assert.EndsWith("Z", shownReply.GetProperty("editedAt").GetString(), StringComparison.Ordinal);
        Assert.EndsWith("Z", shownReply.GetProperty("pinnedAt").GetString(), StringComparison.Ordinal);
        Assert.Equal("A page", Assert.Single(shownReply.GetProperty("embeds").EnumerateArray()).GetProperty("title").GetString());
        var reference = shownReply.GetProperty("replyTo");
        Assert.Equal(original.Id.ToString(), reference.GetProperty("id").GetString());
        Assert.Equal(AdaId.ToString(), reference.GetProperty("authorId").GetString());
        Assert.Equal("Ada", reference.GetProperty("authorName").GetString());
        Assert.Equal("look at this", reference.GetProperty("preview").GetString());
        Assert.True(reference.GetProperty("hasAttachment").GetBoolean());

        var reactions = shownReply.GetProperty("reactions").EnumerateArray().ToArray();
        Assert.Equal(["🎉", "👍"], reactions.Select(x => x.GetProperty("emoji").GetString()));
        Assert.Equal([1, 2], reactions.Select(x => x.GetProperty("count").GetInt32()));
        Assert.Equal([false, true], reactions.Select(x => x.GetProperty("mine").GetBoolean()));
    }

    [Fact]
    public async Task VoiceRoomsListTheirOccupants()
    {
        using var factory = new StellarrWebApplicationFactory();
        var presence = factory.Services.GetRequiredService<PresenceTracker>();
        presence.Connect("ada-tab", AdaId);
        presence.JoinVoice("ada-tab", AdaId, TestData.VoiceChannelId);
        presence.SetVoiceMuted("ada-tab", true);
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        var occupant = Assert.Single(snapshot.GetProperty("voice").GetProperty(TestData.VoiceChannelId.ToString()).EnumerateArray());
        Assert.Equal(AdaId.ToString(), occupant.GetProperty("userId").GetString());
        Assert.Equal("Ada", occupant.GetProperty("displayName").GetString());
        Assert.True(occupant.GetProperty("muted").GetBoolean());
        Assert.Equal(0, snapshot.GetProperty("voice").GetProperty(TestData.NightShiftChannelId.ToString()).GetArrayLength());
    }

    [Fact]
    public async Task MembersShowThePresenceTheyChoseToShow()
    {
        using var factory = new StellarrWebApplicationFactory();
        var presence = factory.Services.GetRequiredService<PresenceTracker>();
        presence.Connect("ada-tab", AdaId, showPresence: false);
        presence.Connect("ilya-tab", IlyaId);
        using var owner = await SignInAsync(factory, "maja", "Aurora!2026");
        using var hidden = await SignInAsync(factory, "ada", "Quasar!2026");

        var seenByOwner = await owner.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        var seenByHidden = await hidden.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        Assert.Equal("offline", PresenceOf(seenByOwner, "Ada"));
        Assert.Equal("online", PresenceOf(seenByOwner, "Ilya"));
        Assert.Equal("online", seenByHidden.GetProperty("user").GetProperty("presence").GetString());
        Assert.Equal("online", PresenceOf(seenByHidden, "Ada"));
    }

    [Fact]
    public async Task IceServersFollowTheRtcSettings()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Rtc:PublicHost"] = "relay.example.test",
                ["Rtc:TurnPort"] = "4000",
                ["Rtc:TurnsPort"] = "4001",
                ["Rtc:TurnTcpEnabled"] = "false",
                ["Rtc:TurnsEnabled"] = "true",
            });
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        var rtc = (await client.GetFromJsonAsync<JsonElement>("/api/bootstrap")).GetProperty("rtc");

        Assert.Equal(1, rtc.GetProperty("protocolVersion").GetInt32());
        Assert.Equal("/hubs/app", rtc.GetProperty("signalingHub").GetString());
        var ice = rtc.GetProperty("iceServers").EnumerateArray().ToArray();
        Assert.Equal(["stun:relay.example.test:4000"], Urls(ice[0]));
        Assert.Equal(JsonValueKind.Null, ice[0].GetProperty("credential").ValueKind);
        Assert.Equal(["turn:relay.example.test:4000?transport=udp"], Urls(ice[1]));
        Assert.Equal(["turns:relay.example.test:4001?transport=tcp"], Urls(ice[2]));
        Assert.Equal(ice[1].GetProperty("username").GetString(), ice[2].GetProperty("username").GetString());
        Assert.Equal(ice[1].GetProperty("credential").GetString(), ice[2].GetProperty("credential").GetString());
    }

    [Theory]
    [InlineData(null, "udp://relay.example.test:49000")]
    [InlineData("49001", "udp://relay.example.test:49001")]
    public async Task TheBootstrapNamesTheMediaServerAndItsPublicEndpoint(string? mediaPort, string expected)
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Rtc:PublicHost"] = "relay.example.test",
                ["Rtc:MediaPort"] = mediaPort,
            });
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        var rtc = (await client.GetFromJsonAsync<JsonElement>("/api/bootstrap")).GetProperty("rtc");

        Assert.Equal(expected, rtc.GetProperty("mediaServer").GetString());
        Assert.Equal(1, rtc.GetProperty("protocolVersion").GetInt32());
        Assert.Equal("/hubs/app", rtc.GetProperty("signalingHub").GetString());
    }

    [Theory]
    [InlineData("Rtc:MediaPort", "0")]
    [InlineData("Rtc:MediaPort", "70000")]
    [InlineData("Rtc:MediaControlUrl", "not an address")]
    [InlineData("Rtc:MediaControlUrl", "ftp://127.0.0.1:5200")]
    public void AnUnusableMediaServerSettingStopsTheApiAtStart(string setting, string value)
    {
        var media = new FakeMediaServer();
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { [setting] = value },
            configureServices: media.Install);

        var failure = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Assert.Contains(setting, failure.ToString(), StringComparison.Ordinal);
        Assert.Empty(media.Requests);
    }

    [Theory]
    [InlineData("Rtc:TurnPort", "0")]
    [InlineData("Rtc:TurnPort", "70000")]
    [InlineData("Rtc:TurnsPort", "0")]
    public async Task OutOfRangeRelayPortFailsLoudly(string setting, string value)
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { [setting] = value });
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        Assert.Equal(HttpStatusCode.InternalServerError, (await client.GetAsync("/api/bootstrap")).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("operator-chosen-secret")]
    public async Task RelayCredentialIsAMacOfItsUsernameUnderTheSharedSecret(string? secret)
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Rtc:TurnSharedSecret"] = secret });
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");
        var expiresBefore = DateTimeOffset.UtcNow.AddHours(1).AddMinutes(1).ToUnixTimeSeconds();

        var rtc = (await client.GetFromJsonAsync<JsonElement>("/api/bootstrap")).GetProperty("rtc");

        var relay = rtc.GetProperty("iceServers")[1];
        var username = relay.GetProperty("username").GetString()!;
        var (expiry, user) = (long.Parse(username.Split(':')[0], CultureInfo.InvariantCulture), username.Split(':')[1]);
        Assert.Equal(MajaId.ToString("N"), user);
        Assert.InRange(expiry, DateTimeOffset.UtcNow.AddMinutes(59).ToUnixTimeSeconds(), expiresBefore);
#pragma warning disable CA5350
        var expected = Convert.ToBase64String(HMACSHA1.HashData(
            Encoding.UTF8.GetBytes(secret ?? "stellarr-turn-development-secret"),
            Encoding.UTF8.GetBytes(username)));
#pragma warning restore CA5350
        Assert.Equal(expected, relay.GetProperty("credential").GetString());
    }

    [Fact]
    public async Task GiphyKeyIsServedToSignedInCallersOnly()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["GIPHY_API_KEY"] = "  public-browser-key " });
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");

        var configured = await client.GetFromJsonAsync<JsonElement>("/api/config/giphy");

        Assert.Equal("public-browser-key", configured.GetProperty("apiKey").GetString());
        using var without = new StellarrWebApplicationFactory();
        using var other = await SignInAsync(without, "maja", "Aurora!2026");
        Assert.Equal("", (await other.GetFromJsonAsync<JsonElement>("/api/config/giphy")).GetProperty("apiKey").GetString());
    }

    [Fact]
    public async Task FirstRegisteredOwnerSeesTheWelcomeNoticeFromTheSystem()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = NewClient(factory);
        (await client.PostAsJsonAsync("/api/auth/register", new
        {
            username = "owner",
            displayName = "First Owner",
            email = "owner@example.test",
            password = "Production!2026",
        })).EnsureSuccessStatusCode();

        var snapshot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");

        Assert.Equal(2, snapshot.GetProperty("channels").GetArrayLength());
        var welcome = Assert.Single(snapshot.GetProperty("messages").EnumerateArray());
        Assert.Equal("system", welcome.GetProperty("author").GetProperty("id").GetString());
        Assert.Equal("system", welcome.GetProperty("author").GetProperty("displayName").GetString());
        Assert.Single(snapshot.GetProperty("channelReads").EnumerateObject());
    }

    [Fact]
    public void ProductionRefusesToStartWithoutATurnSecret()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var production = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Production"));

        var failure = Assert.ThrowsAny<Exception>(() => production.CreateClient());

        Assert.Contains("Rtc:TurnSharedSecret", failure.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProductionStartsOnceTheTurnSecretIsSet()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var production = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Rtc:TurnSharedSecret", "operator-chosen-secret");
        });
        using var client = production.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    private static HttpClient NewClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });

    private static async Task<HttpClient> SignInAsync(StellarrWebApplicationFactory factory, string username, string password)
    {
        var client = NewClient(factory);
        using var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        response.EnsureSuccessStatusCode();
        return client;
    }

    private static Task<HttpResponseMessage> SendWithServerAsync(HttpClient client, string path, string server)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add(ServerAccess.HeaderName, server);
        return client.SendAsync(request);
    }

    private static async Task<JsonElement> GetWithServerAsync(HttpClient client, string path, string server)
    {
        using var response = await SendWithServerAsync(client, path, server);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string? PresenceOf(JsonElement snapshot, string displayName) =>
        snapshot.GetProperty("members").EnumerateArray()
            .Single(x => x.GetProperty("displayName").GetString() == displayName)
            .GetProperty("presence").GetString();

    private static string[] Urls(JsonElement iceServer) =>
        iceServer.GetProperty("urls").EnumerateArray().Select(x => x.GetString()!).ToArray();

    /// <summary>
    /// Adds a second server with a text channel, a role that may manage
    /// messages and the given members, all of whom joined after the seeded
    /// server so that it stays everybody's default.
    /// </summary>
    private static async Task<(Guid ServerId, Guid ChannelId)> AddServerAsync(
        StellarrWebApplicationFactory factory,
        string name,
        params Guid[] memberIds)
    {
        await using var scope = factory.OpenScope(out var db);
        var joined = DateTime.UtcNow.AddMinutes(1);
        var server = new StellarrServer { Id = Guid.NewGuid(), Name = name, CreatedAt = joined };
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Gość",
            Color = "#777777",
            Permissions = ServerPrivileges.ManageMessages,
            Position = 0,
            IsSystem = true,
        };
        var channel = new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = $"{name}-ogólny",
            Kind = ChannelKind.Text,
        };
        db.Servers.Add(server);
        db.ServerRoles.Add(role);
        db.Channels.Add(channel);
        db.ServerMembers.AddRange(memberIds.Select(id => new ServerMember
        {
            ServerId = server.Id,
            UserId = id,
            RoleId = role.Id,
            JoinedAt = joined,
        }));
        await db.SaveChangesAsync();
        return (server.Id, channel.Id);
    }

    /// <summary>
    /// Plays the same user's second tab: just before the first save that
    /// starts the user's read markers, it commits the marker of one channel
    /// from a connection of its own.
    /// </summary>
    private sealed class BootstrapInAnotherTab(string databasePath, Guid userId, Guid channelId, DateTime markedAt)
        : SaveChangesInterceptor
    {
        private int _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            var startsMarkers = eventData.Context!.ChangeTracker.Entries<ChannelRead>()
                .Any(x => x.State == EntityState.Added && x.Entity.UserId == userId);
            if (startsMarkers && Interlocked.Exchange(ref _fired, 1) == 0)
            {
                await using var other = new AppDbContext(
                    new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={databasePath}").Options);
                other.ChannelReads.Add(new ChannelRead { ChannelId = channelId, UserId = userId, LastReadAt = markedAt });
                await other.SaveChangesAsync(cancellationToken);
            }

            return result;
        }
    }
}
