using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Embeds;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

/// <summary>
/// A message with a link, through the API, the queue and the worker to the
/// event clients receive. The pages and images come from fakes, so nothing
/// leaves the machine.
/// </summary>
public sealed class EmbedPipelineTests
{
    [Fact]
    public async Task PostingALinkBuildsACardWhoseImageIsServedFromOurOwnOrigin()
    {
        var unfurler = new FakeUnfurler();
        using var factory = CreateFactory(unfurler);
        var (client, cookie) = await SignInAsync(factory);
        await using var updates = await EmbedUpdates.ConnectAsync(factory, cookie);
        var cursor = (await client.GetFromJsonAsync<JsonElement>($"/api/channels/{TestData.GeneralChannelId}/messages?limit=1"))
            .GetProperty("syncCursor").GetString();

        var messageId = await PostAsync(client, "Read https://news.example/story today.");
        var update = await updates.WaitForAsync(messageId);

        var embed = Assert.Single(update.GetProperty("embeds").EnumerateArray());
        Assert.Equal("link", embed.GetProperty("kind").GetString());
        Assert.Equal("news.example", embed.GetProperty("domain").GetString());
        Assert.Equal("https://news.example/story", embed.GetProperty("url").GetString());
        Assert.Equal("Title of news.example", embed.GetProperty("title").GetString());

        // The reader's browser is sent to us, never to the linked host.
        var thumbnailUrl = embed.GetProperty("thumbnailUrl").GetString();
        Assert.StartsWith("/assets/", thumbnailUrl);
        var image = await client.GetAsync(thumbnailUrl);
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(FakeUnfurler.Png, await image.Content.ReadAsByteArrayAsync());

        var stored = await HistoryEmbedsAsync(client, messageId);
        Assert.Equal(embed.GetProperty("id").GetString(), Assert.Single(stored).GetProperty("id").GetString());

        // A client that was offline when the card arrived finds it in the journal.
        var sync = await client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/sync?after={cursor}");
        var changes = sync.GetProperty("changes").EnumerateArray().ToArray();
        Assert.Equal(2, changes.Length); // the send, and the card that followed it
        Assert.All(changes, change => Assert.Equal("upsert", change.GetProperty("kind").GetString()));
        Assert.Single(changes[^1].GetProperty("message").GetProperty("embeds").EnumerateArray());
    }

    [Fact]
    public async Task EveryMessageKeepsItsOwnEmbedAndImage()
    {
        var unfurler = new FakeUnfurler();
        using var factory = CreateFactory(unfurler);
        var (client, cookie) = await SignInAsync(factory);
        await using var updates = await EmbedUpdates.ConnectAsync(factory, cookie);

        var first = await PostAsync(client, "https://news.example/story");
        var second = await PostAsync(client, "https://news.example/story");
        var firstEmbed = Assert.Single((await updates.WaitForAsync(first)).GetProperty("embeds").EnumerateArray());
        var secondEmbed = Assert.Single((await updates.WaitForAsync(second)).GetProperty("embeds").EnumerateArray());

        Assert.NotEqual(firstEmbed.GetProperty("id").GetString(), secondEmbed.GetProperty("id").GetString());
        var firstImage = firstEmbed.GetProperty("thumbnailUrl").GetString()!;
        var secondImage = secondEmbed.GetProperty("thumbnailUrl").GetString()!;
        Assert.NotEqual(firstImage, secondImage);

        // Removing one message takes its image along and leaves the other's.
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/messages/{first}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(firstImage)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(secondImage)).StatusCode);
    }

    [Fact]
    public async Task WithEmbedsDisabledAVideoLinkIsStillAPlayerAndNothingIsFetched()
    {
        var unfurler = new FakeUnfurler();
        var youTube = new FakeYouTube();
        using var factory = CreateFactory(unfurler, youTube, enabled: false);
        var (client, cookie) = await SignInAsync(factory);
        await using var updates = await EmbedUpdates.ConnectAsync(factory, cookie);

        var messageId = await PostAsync(client, "https://news.example/story https://youtu.be/aqz-KE-bpKQ?t=95");
        var update = await updates.WaitForAsync(messageId);

        var embed = Assert.Single(update.GetProperty("embeds").EnumerateArray());
        Assert.Equal("video", embed.GetProperty("kind").GetString());
        Assert.Equal("youtube", embed.GetProperty("provider").GetString());
        Assert.Equal("aqz-KE-bpKQ", embed.GetProperty("providerId").GetString());
        Assert.Equal(95, embed.GetProperty("startSeconds").GetInt32());
        Assert.Equal(JsonValueKind.Null, embed.GetProperty("title").ValueKind);
        Assert.Equal(JsonValueKind.Null, embed.GetProperty("thumbnailUrl").ValueKind);
        Assert.Equal(0, unfurler.CardCalls + unfurler.ImageCalls + youTube.Calls);
    }

    [Fact]
    public async Task AStoreOutageLeavesAStaleImageQueuedUntilMaintenanceCanDeleteIt()
    {
        using var factory = CreateFactory(new FakeUnfurler());
        using var client = factory.CreateClient();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var (messageId, attachmentId, objectKey) = await SeedStaleEmbedAsync(db, storage);

        storage.RejectDeletes = true;
        await scope.ServiceProvider.GetRequiredService<EmbedBuilder>().ClearAsync(messageId, CancellationToken.None);

        Assert.False(await db.ImageAttachments.AnyAsync(x => x.Id == attachmentId));
        Assert.True(await db.ObjectDeletions.AnyAsync(x => x.ObjectKey == objectKey));
        Assert.True(storage.Contains(objectKey));

        storage.RejectDeletes = false;
        await scope.ServiceProvider.GetRequiredService<MediaStorage>()
            .DrainDeletionQueueAsync(10, CancellationToken.None);
        Assert.False(storage.Contains(objectKey));
    }

    [Fact]
    public async Task EditingAMessageAddsAndRemovesItsCards()
    {
        using var factory = CreateFactory(new FakeUnfurler());
        var (client, cookie) = await SignInAsync(factory);
        await using var updates = await EmbedUpdates.ConnectAsync(factory, cookie);
        var storage = (FakeObjectStorage)factory.Services.GetRequiredService<IObjectStorage>();

        // Every send is queued, and a message without a link ends up with an
        // empty set.
        var messageId = await PostAsync(client, "nothing to see here");
        Assert.Empty((await updates.WaitForAsync(messageId)).GetProperty("embeds").EnumerateArray());
        Assert.Empty(await HistoryEmbedsAsync(client, messageId));

        await EditAsync(client, messageId, "now with https://news.example/story");
        var added = Assert.Single((await updates.WaitForAsync(messageId)).GetProperty("embeds").EnumerateArray());
        Assert.Equal("news.example", added.GetProperty("domain").GetString());
        Assert.Single(await HistoryEmbedsAsync(client, messageId));
        Assert.Equal(1, storage.Count);

        await EditAsync(client, messageId, "and now without one");
        Assert.Empty((await updates.WaitForAsync(messageId)).GetProperty("embeds").EnumerateArray());
        Assert.Empty(await HistoryEmbedsAsync(client, messageId));
        Assert.Equal(0, storage.Count);
    }

    [Fact]
    public async Task RecoveryQueuesOnlyYouTubeEmbedsThatNeverGotATitle()
    {
        using var factory = CreateFactory(new FakeUnfurler());
        using var client = factory.CreateClient();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stale = await AddYouTubeMessageAsync(db, title: null);
        await AddYouTubeMessageAsync(db, title: "Already complete");

        var inbox = new EmbedInbox();
        await EmbedRecovery.EnqueueStaleYouTubeAsync(db, inbox, CancellationToken.None);

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await using var queued = inbox.ReadAllAsync(timeout.Token).GetAsyncEnumerator(timeout.Token);
        Assert.True(await queued.MoveNextAsync());
        Assert.Equal(new EmbedRequest(TestData.GeneralChannelId, stale), queued.Current);

        // Nothing else was queued: the next read just waits.
        timeout.CancelAfter(TimeSpan.FromMilliseconds(300));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await queued.MoveNextAsync());
    }

    [Fact]
    public async Task AYouTubeEmbedFromBeforeTheResolverIsRebuiltWhenTheServerStarts()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"stellarr-tests-{Guid.NewGuid():N}.db");
        var dataRoot = Path.Combine(Path.GetTempPath(), $"stellarr-data-{Guid.NewGuid():N}");
        try
        {
            Guid messageId;
            using (var before = new StellarrWebApplicationFactory(
                loadTestData: true, databasePath: databasePath, dataRoot: dataRoot, deleteStorageOnDispose: false))
            {
                using var client = before.CreateClient();
                await using var scope = before.Services.CreateAsyncScope();
                messageId = await AddYouTubeMessageAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), title: null);
            }

            using var after = new StellarrWebApplicationFactory(
                loadTestData: true,
                databasePath: databasePath,
                dataRoot: dataRoot,
                deleteStorageOnDispose: false,
                configureServices: UseFakes(new FakeUnfurler(), new FakeYouTube()));
            using var afterClient = after.CreateClient();

            var title = await PollAsync(async () =>
            {
                await using var scope = after.Services.CreateAsyncScope();
                return await scope.ServiceProvider.GetRequiredService<AppDbContext>().MessageEmbeds
                    .Where(x => x.MessageId == messageId)
                    .Select(x => x.Title)
                    .SingleOrDefaultAsync();
            });
            Assert.Equal("Video title", title);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                File.Delete(databasePath + suffix);
            }

            if (Directory.Exists(dataRoot))
            {
                Directory.Delete(dataRoot, recursive: true);
            }
        }
    }

    private static async Task<Guid> AddYouTubeMessageAsync(AppDbContext db, string? title)
    {
        var messageId = Guid.NewGuid();
        db.Messages.Add(new Message
        {
            Id = messageId,
            ChannelId = TestData.GeneralChannelId,
            AuthorId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync(),
            Content = "https://youtu.be/aqz-KE-bpKQ",
            CreatedAt = DateTime.UtcNow,
        });
        db.MessageEmbeds.Add(new MessageEmbed
        {
            Id = Guid.NewGuid(),
            MessageId = messageId,
            Url = "https://youtu.be/aqz-KE-bpKQ",
            Kind = EmbedKind.Video,
            Provider = VideoLinks.YouTube,
            ProviderId = "aqz-KE-bpKQ",
            Domain = "youtu.be",
            Title = title,
            Position = 0,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return messageId;
    }

    private static async Task<T?> PollAsync<T>(Func<Task<T?>> read)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        T? value = await read();
        while (value is null && DateTime.UtcNow < deadline)
        {
            await Task.Delay(50);
            value = await read();
        }

        return value;
    }

    private static async Task EditAsync(HttpClient client, Guid messageId, string content) =>
        (await client.PatchAsJsonAsync($"/api/messages/{messageId}", new { content })).EnsureSuccessStatusCode();

    internal static StellarrWebApplicationFactory CreateFactory(
        FakeUnfurler unfurler,
        FakeYouTube? youTube = null,
        bool enabled = true) =>
        new(
            loadTestData: true,
            configuration: new Dictionary<string, string?> { ["Stellarr:Embeds:Enabled"] = enabled.ToString() },
            configureServices: UseFakes(unfurler, youTube ?? new FakeYouTube()));

    internal static Action<IServiceCollection> UseFakes(FakeUnfurler unfurler, FakeYouTube youTube) => services =>
    {
        services.RemoveAll<ILinkUnfurler>();
        services.AddSingleton<ILinkUnfurler>(unfurler);
        services.RemoveAll<IYouTubeMetadataResolver>();
        services.AddSingleton<IYouTubeMetadataResolver>(youTube);
    };

    /// <summary>Signs in as maja; the factory disposes the client with itself.</summary>
    internal static async Task<(HttpClient Client, string Cookie)> SignInAsync(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        return (client, cookie);
    }

    /// <summary>Posts to #general under an id of the test's choosing, and returns the id.</summary>
    internal static async Task<Guid> PostAsync(HttpClient client, string content)
    {
        var messageId = Guid.NewGuid();
        (await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content, attachmentIds = Array.Empty<Guid>(), clientMessageId = messageId }))
            .EnsureSuccessStatusCode();
        return messageId;
    }

    private static async Task<JsonElement[]> HistoryEmbedsAsync(HttpClient client, Guid messageId)
    {
        var history = await client.GetFromJsonAsync<JsonElement>($"/api/channels/{TestData.GeneralChannelId}/messages");
        return [.. history.GetProperty("messages").EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == messageId.ToString())
            .GetProperty("embeds").EnumerateArray()];
    }

    /// <summary>An embed with a stored preview image, for a message that has no link.</summary>
    internal static async Task<(Guid MessageId, Guid AttachmentId, string ObjectKey)> SeedStaleEmbedAsync(
        AppDbContext db,
        FakeObjectStorage storage)
    {
        var messageId = Guid.NewGuid();
        var attachmentId = Guid.NewGuid();
        var objectKey = $"embeds/tests/{attachmentId:N}.png";
        using (var content = new MemoryStream(FakeUnfurler.Png))
        {
            await storage.PutAsync(objectKey, content, "image/png", CancellationToken.None);
        }

        db.Messages.Add(new Message
        {
            Id = messageId,
            ChannelId = TestData.GeneralChannelId,
            AuthorId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync(),
            Content = "no link any more",
            CreatedAt = DateTime.UtcNow,
        });
        db.ImageAttachments.Add(new ImageAttachment
        {
            Id = attachmentId,
            UploadedById = Guid.Empty,
            ObjectKey = objectKey,
            FileName = "preview.png",
            ContentType = "image/png",
            SizeBytes = FakeUnfurler.Png.Length,
            CreatedAt = DateTime.UtcNow,
        });
        db.MessageEmbeds.Add(new MessageEmbed
        {
            Id = Guid.NewGuid(),
            MessageId = messageId,
            Url = "https://example.test/old",
            Provider = "example.test",
            Domain = "example.test",
            ThumbnailAttachmentId = attachmentId,
            Position = 0,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return (messageId, attachmentId, objectKey);
    }
}

internal sealed class FakeUnfurler : ILinkUnfurler
{
    private int _cardCalls;
    private int _imageCalls;

    /// <summary>Starts like a PNG, which is all the stored copy is checked for.</summary>
    internal static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

    internal int CardCalls => _cardCalls;
    internal int ImageCalls => _imageCalls;

    public Task<PageCard?> FetchCardAsync(Uri url, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _cardCalls);
        return Task.FromResult<PageCard?>(new PageCard($"Title of {url.Host}", "About it", $"https://{url.Host}/cover.png"));
    }

    public Task<FetchedImage?> FetchImageAsync(Uri url, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _imageCalls);
        return Task.FromResult<FetchedImage?>(new FetchedImage(Png, "image/png", "preview.png"));
    }
}

internal sealed class FakeYouTube : IYouTubeMetadataResolver
{
    private int _calls;

    internal int Calls => _calls;

    public Task<PageCard?> FetchAsync(VideoLink video, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _calls);
        return Task.FromResult<PageCard?>(
            new PageCard("Video title", null, $"https://i.ytimg.com/vi/{video.Id}/hqdefault.jpg"));
    }
}

/// <summary>A SignalR connection that keeps every embeds update, per message, in the order it arrived.</summary>
internal sealed class EmbedUpdates : IAsyncDisposable
{
    private readonly ConcurrentDictionary<Guid, Channel<JsonElement>> _updates = new();
    private readonly HubConnection _connection;

    private EmbedUpdates(HubConnection connection)
    {
        _connection = connection;
        _connection.On<JsonElement>("MessageEmbedsUpdated", payload =>
        {
            var messageId = Guid.Parse(payload.GetProperty("messageId").GetString()!);
            Slot(messageId).Writer.TryWrite(payload);
        });
    }

    internal static async Task<EmbedUpdates> ConnectAsync(StellarrWebApplicationFactory factory, string cookie)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        var updates = new EmbedUpdates(connection);
        await connection.StartAsync();
        return updates;
    }

    /// <summary>The next update about the message that has not been waited for yet.</summary>
    internal async Task<JsonElement> WaitForAsync(Guid messageId)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        return await Slot(messageId).Reader.ReadAsync(timeout.Token);
    }

    private Channel<JsonElement> Slot(Guid messageId) => _updates.GetOrAdd(messageId, _ => System.Threading.Channels.Channel.CreateUnbounded<JsonElement>());

    public ValueTask DisposeAsync() => _connection.DisposeAsync();
}
