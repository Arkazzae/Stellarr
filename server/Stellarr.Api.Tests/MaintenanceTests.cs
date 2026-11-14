using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Maintenance;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class MaintenanceTests
{
    [Fact]
    public async Task CompactsOldMessageChangesBehindResetMarker()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?>
            {
                ["Maintenance:MessageChangeRetentionDays"] = "7",
            });
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");
        var now = DateTime.UtcNow;
        var oldMessageId = Guid.NewGuid();
        var recentMessageId = Guid.NewGuid();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.MessageChanges.AddRange(
                new MessageChange
                {
                    ChannelId = TestData.GeneralChannelId,
                    MessageId = oldMessageId,
                    Kind = MessageChangeKind.Delete,
                    CreatedAt = now.AddDays(-10),
                },
                new MessageChange
                {
                    ChannelId = TestData.GeneralChannelId,
                    MessageId = recentMessageId,
                    Kind = MessageChangeKind.Delete,
                    CreatedAt = now.AddDays(-1),
                });
            await db.SaveChangesAsync();
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<InstanceMaintenance>()
                .RunAsync(now, default);
        }

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await verificationDb.MessageChanges.AnyAsync(x => x.MessageId == oldMessageId));
        Assert.True(await verificationDb.MessageChanges.AnyAsync(x => x.MessageId == recentMessageId));
        Assert.True(await verificationDb.MessageChanges.AnyAsync(x =>
            x.ChannelId == TestData.GeneralChannelId && x.Kind == MessageChangeKind.Reset));
    }

    [Fact]
    public async Task PersistsFailedUploadRollbackUntilStorageRecovers()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        const string objectKey = "rollback/will-be-retried.bin";
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var mediaStorage = scope.ServiceProvider.GetRequiredService<MediaStorage>();
        await storage.PutAsync(
            objectKey,
            new MemoryStream([1]),
            default);
        storage.RejectDeletes = true;

        await mediaStorage.RollbackAsync([objectKey]);

        Assert.True(storage.Contains(objectKey));
        Assert.True(await db.ObjectDeletions.AnyAsync(x => x.ObjectKey == objectKey));

        storage.RejectDeletes = false;
        await mediaStorage.DrainDeletionQueueAsync(batchSize: 10, default);

        Assert.False(storage.Contains(objectKey));
        Assert.False(await db.ObjectDeletions.AnyAsync(x => x.ObjectKey == objectKey));
    }

    [Fact]
    public async Task RemovesOnlyExpiredUnreferencedData()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        var now = new DateTime(2026, 8, 15, 12, 0, 0, DateTimeKind.Utc);
        var orphanId = Guid.NewGuid();
        var referencedId = Guid.NewGuid();
        var avatarId = Guid.NewGuid();
        var recentId = Guid.NewGuid();
        const string orphanKey = "maintenance/orphan.bin";
        const string posterKey = "maintenance/orphan-poster.bin";
        const string referencedKey = "maintenance/referenced.bin";
        const string avatarKey = "maintenance/avatar.bin";
        const string recentKey = "maintenance/recent.bin";

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            var user = await db.Users.OrderBy(x => x.CreatedAt).FirstAsync();
            var message = await db.Messages.OrderBy(x => x.CreatedAt).FirstAsync();
            var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();

            var orphan = Attachment(orphanId, user.Id, orphanKey, now.AddDays(-10));
            orphan.PosterObjectKey = posterKey;
            orphan.PosterContentType = "image/webp";
            orphan.PosterSizeBytes = 1;
            db.ImageAttachments.AddRange(
                orphan,
                Attachment(referencedId, user.Id, referencedKey, now.AddDays(-10)),
                Attachment(avatarId, user.Id, avatarKey, now.AddDays(-10)),
                Attachment(recentId, user.Id, recentKey, now.AddHours(-12)));
            db.MessageAttachments.Add(new MessageAttachment
            {
                MessageId = message.Id,
                AttachmentId = referencedId,
            });
            user.AvatarUrl = $"/assets/{avatarId}";
            db.OperationsSettings.Add(new OperationsSettings
            {
                ServerId = server.Id,
                BackupRetentionDays = 2,
                LogRetentionDays = 2,
                OrphanObjectRetentionDays = 2,
                AutomaticCleanupEnabled = true,
                UpdatedAt = now,
            });
            await db.SaveChangesAsync();

            foreach (var key in new[] { orphanKey, posterKey, referencedKey, avatarKey, recentKey })
            {
                await storage.PutAsync(key, new MemoryStream([1]), default);
            }
        }

        var backupDirectory = Directory.CreateDirectory(Path.Combine(factory.DataRoot, "backups"));
        var logDirectory = Directory.CreateDirectory(Path.Combine(factory.DataRoot, "logs"));
        var expiredBackup = Path.Combine(backupDirectory.FullName, "expired.db");
        var currentBackup = Path.Combine(backupDirectory.FullName, "current.db");
        var expiredLog = Path.Combine(logDirectory.FullName, "expired.log");
        var currentLog = Path.Combine(logDirectory.FullName, "current.log");
        await File.WriteAllTextAsync(expiredBackup, "old");
        await File.WriteAllTextAsync(currentBackup, "new");
        await File.WriteAllTextAsync(expiredLog, "old");
        await File.WriteAllTextAsync(currentLog, "new");
        File.SetLastWriteTimeUtc(expiredBackup, now.AddDays(-3));
        File.SetLastWriteTimeUtc(currentBackup, now.AddDays(-1));
        File.SetLastWriteTimeUtc(expiredLog, now.AddDays(-3));
        File.SetLastWriteTimeUtc(currentLog, now.AddDays(-1));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var maintenance = scope.ServiceProvider.GetRequiredService<InstanceMaintenance>();
            var result = await maintenance.RunAsync(now, default);

            Assert.True(result.Enabled);
            Assert.Equal(1, result.OrphanAttachments);
            Assert.Equal(1, result.BackupFiles);
            Assert.Equal(1, result.LogFiles);
            Assert.Equal(0, result.PendingObjectDeletions);
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            Assert.False(await db.ImageAttachments.AnyAsync(x => x.Id == orphanId));
            Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == referencedId));
            Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == avatarId));
            Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == recentId));
            Assert.False(storage.Contains(orphanKey));
            Assert.False(storage.Contains(posterKey));
            Assert.True(storage.Contains(referencedKey));
            Assert.True(storage.Contains(avatarKey));
            Assert.True(storage.Contains(recentKey));
        }

        Assert.False(File.Exists(expiredBackup));
        Assert.True(File.Exists(currentBackup));
        Assert.False(File.Exists(expiredLog));
        Assert.True(File.Exists(currentLog));
    }

    private static ImageAttachment Attachment(Guid id, Guid userId, string key, DateTime createdAt) => new()
    {
        Id = id,
        UploadedById = userId,
        ObjectKey = key,
        FileName = "file.bin",
        ContentType = "application/octet-stream",
        SizeBytes = 1,
        CreatedAt = createdAt,
    };
}
