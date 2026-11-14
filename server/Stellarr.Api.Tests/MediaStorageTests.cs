using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Storage;
using static Stellarr.Api.Tests.DataModelSupport;

namespace Stellarr.Api.Tests;

public sealed class MediaStorageTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid SeededMessageId = Guid.Parse("40000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task AnUnreferencedAttachmentIsQueuedWithItsPosterAndItsRowIsRemoved()
    {
        await using var scope = factory.OpenScope(out var db);
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var uploader = (await AddUsersAsync(db, 1))[0];
        var attachment = Upload(uploader);
        attachment.PosterObjectKey = $"posters/{Guid.NewGuid():N}.jpg";
        db.ImageAttachments.Add(attachment);
        await db.SaveChangesAsync();
        var queuedAt = new DateTime(2026, 3, 1, 10, 0, 0, DateTimeKind.Utc);

        var removed = await mediaStorage.QueueAttachmentIfUnreferencedAsync(
            $"/assets/{attachment.Id}", uploader.Id, queuedAt, default);

        Assert.True(removed);
        Assert.False(await db.ImageAttachments.AnyAsync(x => x.Id == attachment.Id));
        var queued = await db.ObjectDeletions
            .Where(x => x.ObjectKey == attachment.ObjectKey || x.ObjectKey == attachment.PosterObjectKey)
            .ToListAsync();
        Assert.Equal(2, queued.Count);
        Assert.All(queued, x => Assert.Equal(queuedAt, x.QueuedAt));
    }

    [Theory]
    [InlineData("message")]
    [InlineData("avatar")]
    [InlineData("banner")]
    [InlineData("serverIcon")]
    [InlineData("soundboard")]
    [InlineData("embedThumbnail")]
    public async Task AnAttachmentThatSomethingStillUsesIsKept(string reference)
    {
        await using var scope = factory.OpenScope(out var db);
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var uploader = (await AddUsersAsync(db, 1))[0];
        var attachment = Upload(uploader);
        db.ImageAttachments.Add(attachment);
        var assetUrl = $"/assets/{attachment.Id}";
        switch (reference)
        {
            case "message":
                db.MessageAttachments.Add(new MessageAttachment { MessageId = SeededMessageId, Attachment = attachment });
                break;
            case "avatar":
                uploader.AvatarUrl = assetUrl;
                break;
            case "banner":
                uploader.BannerUrl = assetUrl;
                break;
            case "serverIcon":
                db.Servers.Add(new StellarrServer { Id = Guid.NewGuid(), Name = "Icon", IconUrl = assetUrl });
                break;
            case "soundboard":
                db.SoundboardSounds.Add(new SoundboardSound
                {
                    Id = Guid.NewGuid(),
                    ServerId = TestData.ServerId,
                    Attachment = attachment,
                    CreatedById = uploader.Id,
                    Name = "clip",
                    Glyph = "x",
                });
                break;
            case "embedThumbnail":
                db.MessageEmbeds.Add(new MessageEmbed
                {
                    Id = Guid.NewGuid(),
                    MessageId = SeededMessageId,
                    Url = "https://example.test/page",
                    Provider = "example.test",
                    Domain = "example.test",
                    ThumbnailAttachment = attachment,
                });
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(reference));
        }

        await db.SaveChangesAsync();

        Assert.False(await mediaStorage.QueueAttachmentIfUnreferencedAsync(assetUrl, null, DateTime.UtcNow, default));
        Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == attachment.Id));
        Assert.False(await db.ObjectDeletions.AnyAsync(x => x.ObjectKey == attachment.ObjectKey));
    }

    [Fact]
    public async Task OnlyTheUploaderMayRemoveWhenAnUploaderIsNamed()
    {
        await using var scope = factory.OpenScope(out var db);
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var users = await AddUsersAsync(db, 2);
        var attachment = Upload(users[0]);
        db.ImageAttachments.Add(attachment);
        await db.SaveChangesAsync();

        Assert.False(await mediaStorage.QueueAttachmentIfUnreferencedAsync(
            $"/assets/{attachment.Id}", users[1].Id, DateTime.UtcNow, default));
        Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == attachment.Id));

        Assert.True(await mediaStorage.QueueAttachmentIfUnreferencedAsync(
            $"/assets/{attachment.Id}", null, DateTime.UtcNow, default));
        Assert.False(await db.ImageAttachments.AnyAsync(x => x.Id == attachment.Id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("/assets/not-a-guid")]
    [InlineData("https://elsewhere.test/avatar.png")]
    public async Task AddressesThatAreNotAttachmentsQueueNothing(string? assetUrl)
    {
        await using var scope = factory.OpenScope(out var db);
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();

        Assert.False(await mediaStorage.QueueAttachmentIfUnreferencedAsync(assetUrl, null, DateTime.UtcNow, default));
        Assert.False(db.ChangeTracker.HasChanges());
    }

    [Fact]
    public async Task APosterAddressIsNotTheAttachmentItselfAndAnUnknownIdIsIgnored()
    {
        await using var scope = factory.OpenScope(out var db);
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var uploader = (await AddUsersAsync(db, 1))[0];
        var attachment = Upload(uploader);
        db.ImageAttachments.Add(attachment);
        await db.SaveChangesAsync();

        Assert.False(await mediaStorage.QueueAttachmentIfUnreferencedAsync(
            $"/assets/{attachment.Id}/poster", null, DateTime.UtcNow, default));
        Assert.False(await mediaStorage.QueueAttachmentIfUnreferencedAsync(
            $"/assets/{Guid.NewGuid()}", null, DateTime.UtcNow, default));
        Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == attachment.Id));
    }

    [Fact]
    public async Task QueuingTheSameObjectTwiceKeepsOneEntry()
    {
        await using var scope = factory.OpenScope(out var db);
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var key = $"queue/{Guid.NewGuid():N}";

        await mediaStorage.QueueDeletionAsync([key, null, key], DateTime.UtcNow, default);
        await mediaStorage.QueueDeletionAsync([key], DateTime.UtcNow, default);
        await db.SaveChangesAsync();
        await mediaStorage.QueueDeletionAsync([key], DateTime.UtcNow, default);
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.ObjectDeletions.CountAsync(x => x.ObjectKey == key));
    }

    [Fact]
    public async Task ARollbackRemovesTheObjectsItCanAndQueuesTheOnesItCannot()
    {
        using var isolated = new StellarrWebApplicationFactory();
        await using var scope = isolated.OpenScope(out var db);
        var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        await storage.PutAsync("rollback/removable", new MemoryStream([1]), default);
        await storage.PutAsync("rollback/stuck", new MemoryStream([1]), default);

        await mediaStorage.RollbackAsync(["rollback/removable", null, "rollback/removable"]);

        Assert.False(storage.Contains("rollback/removable"));
        Assert.False(await db.ObjectDeletions.AnyAsync());

        storage.RejectDeletes = true;
        await mediaStorage.RollbackAsync(["rollback/stuck", "rollback/stuck"]);

        Assert.True(storage.Contains("rollback/stuck"));
        Assert.Equal(
            ["rollback/stuck"],
            await db.ObjectDeletions.Select(x => x.ObjectKey).ToListAsync());
    }

    [Fact]
    public async Task ARollbackSurvivesTheRejectedChangesThatCalledIt()
    {
        using var isolated = new StellarrWebApplicationFactory();
        await using var scope = isolated.OpenScope(out var db);
        var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var uploader = (await AddUsersAsync(db, 1))[0];
        var stored = Upload(uploader);
        db.ImageAttachments.Add(stored);
        await db.SaveChangesAsync();
        await storage.PutAsync(stored.ObjectKey, new MemoryStream([1]), default);
        storage.RejectDeletes = true;

        // Another row for the same object cannot be saved, as after a failed upload.
        var rejected = Upload(uploader);
        rejected.ObjectKey = stored.ObjectKey;
        db.ImageAttachments.Add(rejected);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        await mediaStorage.RollbackAsync([stored.ObjectKey]);

        Assert.True(await db.ObjectDeletions.AnyAsync(x => x.ObjectKey == stored.ObjectKey));
    }

    [Fact]
    public async Task DrainingDeletesTheOldestObjectsFirstAndKeepsTheOnesThatFail()
    {
        using var isolated = new StellarrWebApplicationFactory();
        await using var scope = isolated.OpenScope(out var db);
        var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        string[] keys = ["drain/oldest", "drain/middle", "drain/newest"];
        foreach (var (key, index) in keys.Select((key, index) => (key, index)))
        {
            await storage.PutAsync(key, new MemoryStream([1]), default);
            await mediaStorage.QueueDeletionAsync([key], start.AddMinutes(index), default);
        }

        await db.SaveChangesAsync();

        storage.RejectDeletes = true;
        await mediaStorage.DrainDeletionQueueAsync(batchSize: 2, default);

        Assert.Equal(3, await db.ObjectDeletions.CountAsync());
        Assert.All(keys, key => Assert.True(storage.Contains(key)));

        storage.RejectDeletes = false;
        await mediaStorage.DrainDeletionQueueAsync(batchSize: 2, default);

        Assert.False(storage.Contains("drain/oldest"));
        Assert.False(storage.Contains("drain/middle"));
        Assert.True(storage.Contains("drain/newest"));
        Assert.Equal(["drain/newest"], await db.ObjectDeletions.Select(x => x.ObjectKey).ToListAsync());

        await mediaStorage.DrainDeletionQueueAsync(batchSize: 2, default);

        Assert.False(storage.Contains("drain/newest"));
        Assert.False(await db.ObjectDeletions.AnyAsync());
    }

    [Fact]
    public async Task TheUserQuotaCountsStoredBytesPostersAndUploadsInFlight()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var stored = Upload(user);
        stored.SizeBytes = 50;
        stored.PosterSizeBytes = 10;
        db.ImageAttachments.Add(stored);
        await db.SaveChangesAsync();
        using var gate = Gate(new UploadOptions { MaxStoredBytesPerUser = 100, MinimumFreeDataRootBytes = 0 });

        Assert.Equal(UploadAdmissionFailure.UserQuota, (await gate.TryEnterAsync(db, user.Id, 41, default)).Failure);

        var first = await gate.TryEnterAsync(db, user.Id, 30, default);
        Assert.True(first.Accepted);
        var second = await gate.TryEnterAsync(db, user.Id, 11, default);
        Assert.Equal(UploadAdmissionFailure.UserQuota, second.Failure);
        Assert.Null(second.Lease);

        await first.Lease.DisposeAsync();

        var third = await gate.TryEnterAsync(db, user.Id, 30, default);
        Assert.True(third.Accepted);
        await third.Lease.DisposeAsync();
    }

    [Fact]
    public async Task AnotherUsersUploadsDoNotCountTowardsTheUserQuota()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var stored = Upload(users[0]);
        stored.SizeBytes = 100;
        db.ImageAttachments.Add(stored);
        await db.SaveChangesAsync();
        using var gate = Gate(new UploadOptions { MaxStoredBytesPerUser = 100, MinimumFreeDataRootBytes = 0 });

        var admission = await gate.TryEnterAsync(db, users[1].Id, 100, default);

        Assert.True(admission.Accepted);
        await admission.Lease.DisposeAsync();
    }

    [Fact]
    public async Task TheInstanceQuotaCountsEveryonesBytesAndUploadsInFlight()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var stored = await db.ImageAttachments.SumAsync(x => (long?)x.SizeBytes + (x.PosterSizeBytes ?? 0)) ?? 0;
        using var gate = Gate(new UploadOptions { MaxStoredBytes = stored + 10, MinimumFreeDataRootBytes = 0 });

        Assert.Equal(UploadAdmissionFailure.InstanceQuota, (await gate.TryEnterAsync(db, users[0].Id, 11, default)).Failure);

        var first = await gate.TryEnterAsync(db, users[0].Id, 6, default);
        Assert.True(first.Accepted);
        Assert.Equal(UploadAdmissionFailure.InstanceQuota, (await gate.TryEnterAsync(db, users[1].Id, 5, default)).Failure);

        var second = await gate.TryEnterAsync(db, users[1].Id, 4, default);
        Assert.True(second.Accepted);
        await first.Lease.DisposeAsync();
        await second.Lease.DisposeAsync();
    }

    [Fact]
    public async Task AQuotaOfZeroMeansNoQuota()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        using var gate = Gate(new UploadOptions
        {
            MaxStoredBytesPerUser = 0,
            MaxStoredBytes = 0,
            MinimumFreeDataRootBytes = 0,
        });

        var admission = await gate.TryEnterAsync(db, user.Id, long.MaxValue / 4, default);

        Assert.True(admission.Accepted);
        await admission.Lease.DisposeAsync();
    }

    [Fact]
    public async Task UploadsAreRefusedWhenTheDataVolumeWouldFallBelowItsReserve()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        using var gate = Gate(new UploadOptions { MinimumFreeDataRootBytes = long.MaxValue });

        var admission = await gate.TryEnterAsync(db, user.Id, 1, default);

        Assert.Equal(UploadAdmissionFailure.LowDiskSpace, admission.Failure);
    }

    [Fact]
    public async Task OnlyAsManyUploadsAsConfiguredAreAdmittedAtOnce()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        using var gate = Gate(new UploadOptions { MaxConcurrentUploads = 1, MinimumFreeDataRootBytes = 0 });
        var first = await gate.TryEnterAsync(db, user.Id, 1, default);
        Assert.True(first.Accepted);

        var waiting = gate.TryEnterAsync(db, user.Id, 1, default);

        Assert.False(await CompletesSoonAsync(waiting));

        await first.Lease.DisposeAsync();
        // Releasing a lease twice must not hand out a second slot.
        await first.Lease.DisposeAsync();
        var second = await waiting.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(second.Accepted);

        var third = gate.TryEnterAsync(db, user.Id, 1, default);
        Assert.False(await CompletesSoonAsync(third));
        await second.Lease.DisposeAsync();
        Assert.True((await third.WaitAsync(TimeSpan.FromSeconds(10))).Accepted);
    }

    [Fact]
    public async Task TheAttachmentSchemaStepRestoresWhatAnOlderVolumeLacksAndKeepsItsRows()
    {
        using var isolated = new StellarrWebApplicationFactory();
        await using var scope = isolated.OpenScope(out var db);
        var uploader = (await AddUsersAsync(db, 1))[0];
        var attachment = Upload(uploader);
        db.ImageAttachments.Add(attachment);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "ImageAttachments" DROP COLUMN "DurationSeconds";
            ALTER TABLE "ImageAttachments" DROP COLUMN "PosterObjectKey";
            ALTER TABLE "ImageAttachments" DROP COLUMN "PosterContentType";
            ALTER TABLE "ImageAttachments" DROP COLUMN "PosterSizeBytes";
            ALTER TABLE "ImageAttachments" DROP COLUMN "IsVoiceMessage";
            DROP TABLE "ObjectDeletions";
            """);

        await DatabaseSchema.UpgradeAsync(db, default);
        await DatabaseSchema.UpgradeAsync(db, default);

        var columns = await db.Database
            .SqlQuery<string>($"""SELECT "name" AS "Value" FROM pragma_table_info('ImageAttachments')""")
            .ToListAsync();
        foreach (var column in new[]
            { "DurationSeconds", "PosterObjectKey", "PosterContentType", "PosterSizeBytes", "IsVoiceMessage" })
        {
            Assert.Contains(column, columns);
        }

        db.ChangeTracker.Clear();
        var restored = await db.ImageAttachments.SingleAsync(x => x.Id == attachment.Id);
        Assert.False(restored.IsVoiceMessage);
        Assert.Null(restored.DurationSeconds);

        db.ObjectDeletions.Add(new ObjectDeletion { ObjectKey = "after/upgrade", QueuedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var indexes = await db.Database
            .SqlQuery<string>($"""SELECT "name" AS "Value" FROM pragma_index_list('ObjectDeletions')""")
            .ToListAsync();
        Assert.Contains("IX_ObjectDeletions_QueuedAt", indexes);
    }

    private static async Task<bool> CompletesSoonAsync(Task task) =>
        await Task.WhenAny(task, Task.Delay(150)) == task;

    private static UploadAdmissionGate Gate(UploadOptions options) =>
        new(
            Options.Create(options),
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["DataRoot"] = Path.GetTempPath() })
                .Build());
}
