using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Maintenance;
using Stellarr.Api.Storage;
using static Stellarr.Api.Tests.DataModelSupport;

namespace Stellarr.Api.Tests;

/// <summary>
/// The parts of <see cref="InstanceMaintenance"/> that the end-to-end retention
/// test does not reach: the switch that turns cleanup off, the journal limits,
/// the references that keep an attachment, and the default settings.
/// </summary>
public sealed class MaintenanceRetentionTests
{
    private static readonly DateTime Now = new(2026, 8, 15, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task WithCleanupSwitchedOffOnlyTheDeletionQueueIsDrained()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        const string queuedKey = "maintenance/queued.bin";
        const string orphanKey = "maintenance/old-orphan.bin";
        var orphanId = Guid.NewGuid();
        var backupDirectory = Directory.CreateDirectory(Path.Combine(factory.DataRoot, "backups"));
        var expiredBackup = Path.Combine(backupDirectory.FullName, "expired.db");
        await File.WriteAllTextAsync(expiredBackup, "old");
        File.SetLastWriteTimeUtc(expiredBackup, Now.AddDays(-30));

        await using (var scope = factory.OpenScope(out var db))
        {
            var uploader = (await AddUsersAsync(db, 1))[0];
            db.OperationsSettings.Add(new OperationsSettings
            {
                ServerId = TestData.ServerId,
                AutomaticCleanupEnabled = false,
                OrphanObjectRetentionDays = 1,
                BackupRetentionDays = 1,
                UpdatedAt = Now,
            });
            db.ImageAttachments.Add(Attachment(orphanId, uploader, orphanKey, Now.AddDays(-10)));
            db.ObjectDeletions.Add(new ObjectDeletion { ObjectKey = queuedKey, QueuedAt = Now.AddDays(-1) });
            await db.SaveChangesAsync();
            var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            await PutAsync(storage, queuedKey);
            await PutAsync(storage, orphanKey);
        }

        var result = await RunAsync(factory, Now);

        Assert.Equal(new MaintenanceResult(false, 0, 0, 0, 0), result);
        await using var verification = factory.OpenScope(out var verificationDb);
        var verificationStorage = (FakeObjectStorage)verification.ServiceProvider.GetRequiredService<IObjectStorage>();
        Assert.False(verificationStorage.Contains(queuedKey));
        Assert.False(await verificationDb.ObjectDeletions.AnyAsync(x => x.ObjectKey == queuedKey));
        Assert.True(await verificationDb.ImageAttachments.AnyAsync(x => x.Id == orphanId));
        Assert.True(verificationStorage.Contains(orphanKey));
        Assert.True(File.Exists(expiredBackup));
    }

    [Theory]
    [InlineData("1", 5, true)]
    [InlineData("1", 8, false)]
    [InlineData("1000", 364, true)]
    [InlineData("1000", 366, false)]
    public async Task TheJournalRetentionIsKeptBetweenSevenAndThreeHundredSixtyFiveDays(
        string configured,
        int ageInDays,
        bool survives)
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["Maintenance:MessageChangeRetentionDays"] = configured });
        await BootAsync(factory);
        var messageId = Guid.NewGuid();
        await using (var scope = factory.OpenScope(out var db))
        {
            db.MessageChanges.Add(new MessageChange
            {
                ChannelId = TestData.GeneralChannelId,
                MessageId = messageId,
                Kind = MessageChangeKind.Delete,
                CreatedAt = Now.AddDays(-ageInDays),
            });
            await db.SaveChangesAsync();
        }

        await RunAsync(factory, Now);

        await using var verification = factory.OpenScope(out var verificationDb);
        Assert.Equal(survives, await verificationDb.MessageChanges.AnyAsync(x => x.MessageId == messageId));
        Assert.Equal(
            !survives,
            await verificationDb.MessageChanges.AnyAsync(x => x.Kind == MessageChangeKind.Reset));
    }

    [Fact]
    public async Task OneResetMarkerIsWrittenForEachChannelThatLostEntries()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        await using (var scope = factory.OpenScope(out var db))
        {
            db.MessageChanges.AddRange(
                OldChange(TestData.GeneralChannelId),
                OldChange(TestData.GeneralChannelId),
                OldChange(TestData.MemesChannelId));
            await db.SaveChangesAsync();
        }

        await RunAsync(factory, Now);

        await using var verification = factory.OpenScope(out var verificationDb);
        var resets = await verificationDb.MessageChanges
            .Where(x => x.Kind == MessageChangeKind.Reset)
            .ToListAsync();
        Assert.Equal(
            [TestData.GeneralChannelId, TestData.MemesChannelId],
            resets.Select(x => x.ChannelId).Order());
        Assert.All(resets, reset =>
        {
            Assert.Equal(Guid.Empty, reset.MessageId);
            Assert.Equal(Now, reset.CreatedAt);
        });
        Assert.False(await verificationDb.MessageChanges.AnyAsync(x => x.Kind == MessageChangeKind.Delete));
    }

    // With a batch of one, an attachment that is kept but still found as a
    // candidate would take the only place and leave the orphan for later runs.
    [Theory]
    [InlineData("directMessage")]
    [InlineData("embedThumbnail")]
    [InlineData("soundboard")]
    public async Task AnAttachmentThatIsStillUsedIsNotAnOrphan(string reference)
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["Maintenance:BatchSize"] = "1" });
        await BootAsync(factory);
        var usedId = Guid.NewGuid();
        var orphanId = Guid.NewGuid();
        const string usedKey = "maintenance/used.bin";
        const string orphanKey = "maintenance/orphan.bin";

        await using (var scope = factory.OpenScope(out var db))
        {
            var users = await AddUsersAsync(db, 2);
            var used = Attachment(usedId, users[0], usedKey, Now.AddDays(-10));
            db.ImageAttachments.AddRange(used, Attachment(orphanId, users[0], orphanKey, Now.AddDays(-9)));
            await AddReferenceAsync(db, reference, used, users);
            await db.SaveChangesAsync();
            var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            await PutAsync(storage, usedKey);
            await PutAsync(storage, orphanKey);
        }

        var result = await RunAsync(factory, Now);

        Assert.Equal(1, result.OrphanAttachments);
        await using var verification = factory.OpenScope(out var verificationDb);
        var verificationStorage = (FakeObjectStorage)verification.ServiceProvider.GetRequiredService<IObjectStorage>();
        Assert.True(await verificationDb.ImageAttachments.AnyAsync(x => x.Id == usedId));
        Assert.True(verificationStorage.Contains(usedKey));
        Assert.False(await verificationDb.ImageAttachments.AnyAsync(x => x.Id == orphanId));
        Assert.False(verificationStorage.Contains(orphanKey));
    }

    [Fact]
    public async Task WithoutStoredSettingsTheDefaultsApply()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        var orphanId = Guid.NewGuid();
        var recentId = Guid.NewGuid();
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.False(await db.OperationsSettings.AnyAsync());
            var uploader = (await AddUsersAsync(db, 1))[0];
            db.ImageAttachments.AddRange(
                Attachment(orphanId, uploader, "maintenance/two-days.bin", Now.AddDays(-2)),
                Attachment(recentId, uploader, "maintenance/twelve-hours.bin", Now.AddHours(-12)));
            await db.SaveChangesAsync();
        }

        var result = await RunAsync(factory, Now);

        Assert.True(result.Enabled);
        Assert.Equal(1, result.OrphanAttachments);
        await using var verification = factory.OpenScope(out var verificationDb);
        Assert.False(await verificationDb.ImageAttachments.AnyAsync(x => x.Id == orphanId));
        Assert.True(await verificationDb.ImageAttachments.AnyAsync(x => x.Id == recentId));
    }

    [Fact]
    public async Task ObjectsThatCannotBeDeletedStayQueuedUntilAnotherRun()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        const string orphanKey = "maintenance/stuck.bin";
        await using (var scope = factory.OpenScope(out var db))
        {
            var uploader = (await AddUsersAsync(db, 1))[0];
            db.ImageAttachments.Add(Attachment(Guid.NewGuid(), uploader, orphanKey, Now.AddDays(-10)));
            await db.SaveChangesAsync();
            var storage = (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            await PutAsync(storage, orphanKey);
            storage.RejectDeletes = true;
        }

        var first = await RunAsync(factory, Now);

        Assert.Equal(1, first.OrphanAttachments);
        Assert.Equal(1, first.PendingObjectDeletions);

        await using (var scope = factory.OpenScope(out _))
        {
            ((FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>()).RejectDeletes = false;
        }

        var second = await RunAsync(factory, Now.AddHours(1));

        Assert.Equal(0, second.OrphanAttachments);
        Assert.Equal(0, second.PendingObjectDeletions);
        await using var verification = factory.OpenScope(out _);
        Assert.False(((FakeObjectStorage)verification.ServiceProvider.GetRequiredService<IObjectStorage>())
            .Contains(orphanKey));
    }

    private static async Task BootAsync(StellarrWebApplicationFactory factory)
    {
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");
    }

    private static async Task<MaintenanceResult> RunAsync(StellarrWebApplicationFactory factory, DateTime now)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<InstanceMaintenance>().RunAsync(now, default);
    }

    private static Task PutAsync(FakeObjectStorage storage, string key) =>
        storage.PutAsync(key, new MemoryStream([1]), default);

    private static ImageAttachment Attachment(Guid id, User uploader, string key, DateTime createdAt)
    {
        var attachment = Upload(uploader);
        attachment.Id = id;
        attachment.ObjectKey = key;
        attachment.CreatedAt = createdAt;
        return attachment;
    }

    private static MessageChange OldChange(Guid channelId) => new()
    {
        ChannelId = channelId,
        MessageId = Guid.NewGuid(),
        Kind = MessageChangeKind.Delete,
        CreatedAt = Now.AddDays(-60),
    };

    private static async Task AddReferenceAsync(
        AppDbContext db,
        string reference,
        ImageAttachment attachment,
        User[] users)
    {
        switch (reference)
        {
            case "directMessage":
                var conversationId = Guid.NewGuid();
                db.DirectConversations.Add(new DirectConversation
                {
                    Id = conversationId,
                    UserAId = users[0].Id,
                    UserBId = users[1].Id,
                    CreatedAt = Now.AddDays(-20),
                });
                db.DirectMessages.Add(new DirectMessage
                {
                    Id = Guid.NewGuid(),
                    ConversationId = conversationId,
                    AuthorId = users[0].Id,
                    Content = "file",
                    CreatedAt = Now.AddDays(-10),
                    Attachments = [new DirectMessageAttachment { AttachmentId = attachment.Id }],
                });
                break;
            case "embedThumbnail":
                db.MessageEmbeds.Add(new MessageEmbed
                {
                    Id = Guid.NewGuid(),
                    MessageId = await db.Messages.Select(x => x.Id).FirstAsync(),
                    Url = "https://example.test/page",
                    Provider = "example.test",
                    Domain = "example.test",
                    ThumbnailAttachmentId = attachment.Id,
                });
                break;
            case "soundboard":
                db.SoundboardSounds.Add(new SoundboardSound
                {
                    Id = Guid.NewGuid(),
                    ServerId = TestData.ServerId,
                    AttachmentId = attachment.Id,
                    CreatedById = users[0].Id,
                    Name = "clip",
                    Glyph = "x",
                });
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(reference));
        }
    }
}
