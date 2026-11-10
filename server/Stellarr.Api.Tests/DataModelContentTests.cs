using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using static Stellarr.Api.Tests.DataModelSupport;

namespace Stellarr.Api.Tests;

/// <summary>
/// The entity model of what a server holds beyond its people and channels:
/// emoji, soundboard clips, notifications, operator settings and the message
/// journal, against a database that EnsureCreated has just made.
/// </summary>
public sealed class DataModelContentTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    [Fact]
    public async Task AShortcodeNamesOneEmojiPerServerAndAStoredObjectBacksOne()
    {
        await using var scope = factory.OpenScope(out var db);
        var uploader = (await AddUsersAsync(db, 1))[0];
        var otherServer = await AddServerAsync(db);
        db.ServerEmoji.Add(Emoji(TestData.ServerId, uploader, "party"));
        await db.SaveChangesAsync();

        // Another server may reuse the code.
        db.ServerEmoji.Add(Emoji(otherServer.Id, uploader, "party"));
        await db.SaveChangesAsync();

        db.ServerEmoji.Add(Emoji(TestData.ServerId, uploader, "party"));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        var sameObject = Emoji(TestData.ServerId, uploader, "other");
        sameObject.ObjectKey = (await db.ServerEmoji.FirstAsync(x => x.Shortcode == "party")).ObjectKey;
        db.ServerEmoji.Add(sameObject);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task EmojiLeaveWithTheirServerButKeepTheirUploaderInPlace()
    {
        await using var scope = factory.OpenScope(out var db);
        var uploader = (await AddUsersAsync(db, 1))[0];
        var server = await AddServerAsync(db);
        db.ServerEmoji.Add(Emoji(server.Id, uploader, "wave"));
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<SqliteException>(
            () => db.Users.Where(x => x.Id == uploader.Id).ExecuteDeleteAsync());

        await db.Servers.Where(x => x.Id == server.Id).ExecuteDeleteAsync();

        Assert.False(await db.ServerEmoji.AnyAsync(x => x.ServerId == server.Id));
    }

    [Fact]
    public async Task ASoundboardClipKeepsItsTrimAndIsBackedByOneUpload()
    {
        await using var scope = factory.OpenScope(out var db);
        var creator = (await AddUsersAsync(db, 1))[0];
        var upload = Upload(creator);
        var sound = Sound(creator, upload);
        sound.TrimStartSeconds = 0.25;
        sound.TrimEndSeconds = 3.75;
        db.ImageAttachments.Add(upload);
        db.SoundboardSounds.Add(sound);
        await db.SaveChangesAsync();

        var loaded = await db.SoundboardSounds.AsNoTracking().SingleAsync(x => x.Id == sound.Id);
        Assert.Equal(0.25, loaded.TrimStartSeconds);
        Assert.Equal(3.75, loaded.TrimEndSeconds);

        db.SoundboardSounds.Add(Sound(creator, upload));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task AClipKeepsItsUploadAndItsCreatorAndLeavesWithItsServer()
    {
        await using var scope = factory.OpenScope(out var db);
        var creator = (await AddUsersAsync(db, 1))[0];
        var server = await AddServerAsync(db);
        var upload = Upload(creator);
        var sound = Sound(creator, upload);
        sound.ServerId = server.Id;
        db.ImageAttachments.Add(upload);
        db.SoundboardSounds.Add(sound);
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<SqliteException>(
            () => db.ImageAttachments.Where(x => x.Id == upload.Id).ExecuteDeleteAsync());
        await Assert.ThrowsAsync<SqliteException>(
            () => db.Users.Where(x => x.Id == creator.Id).ExecuteDeleteAsync());

        await db.Servers.Where(x => x.Id == server.Id).ExecuteDeleteAsync();

        Assert.False(await db.SoundboardSounds.AnyAsync(x => x.Id == sound.Id));
        Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == upload.Id));
    }

    [Fact]
    public async Task AChosenJoinSoundNeedsNoClipToStayInThePreferences()
    {
        await using var scope = factory.OpenScope(out var db);
        var creator = (await AddUsersAsync(db, 1))[0];
        var upload = Upload(creator);
        var sound = Sound(creator, upload);
        db.ImageAttachments.Add(upload);
        db.SoundboardSounds.Add(sound);
        db.UserPreferences.Add(new UserPreferenceSettings { UserId = creator.Id, JoinSoundId = sound.Id });
        await db.SaveChangesAsync();

        await db.SoundboardSounds.Where(x => x.Id == sound.Id).ExecuteDeleteAsync();

        // The selection is allowed to dangle; it simply reads as silence.
        Assert.Equal(
            sound.Id,
            await db.UserPreferences.Where(x => x.UserId == creator.Id).Select(x => x.JoinSoundId).SingleAsync());
    }

    [Fact]
    public async Task AnUploadIsNotTiedToTheAccountThatMadeIt()
    {
        await using var scope = factory.OpenScope(out var db);
        var uploader = (await AddUsersAsync(db, 1))[0];
        var upload = Upload(uploader);
        db.ImageAttachments.Add(upload);
        await db.SaveChangesAsync();

        await db.Users.Where(x => x.Id == uploader.Id).ExecuteDeleteAsync();

        Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == upload.Id));
    }

    [Fact]
    public void AJoinSoundNeverPlaysMoreThanItsWindow()
    {
        Assert.Equal(5, JoinSound.MaxSeconds);
        Assert.Equal(TimeSpan.FromSeconds(30), JoinSound.Cooldown);

        // A short clip plays to its own end.
        Assert.Equal(1.5, JoinSound.WindowEnd(trimStartSeconds: 0.5, trimEndSeconds: 1.5));
        // A long one is cut off a window after the point where it starts.
        Assert.Equal(7, JoinSound.WindowEnd(trimStartSeconds: 2, trimEndSeconds: 30));
    }

    [Fact]
    public async Task NotificationsKeepTheirOrderAndAreIdentifiedByAGuid()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var first = Notification(user);
        var second = Notification(user);
        db.UserNotifications.Add(first);
        await db.SaveChangesAsync();
        db.UserNotifications.Add(second);
        await db.SaveChangesAsync();

        Assert.True(first.Sequence > 0);
        Assert.True(second.Sequence > first.Sequence);
        Assert.Equal(
            [first.Id, second.Id],
            await db.UserNotifications.Where(x => x.UserId == user.Id).OrderBy(x => x.Sequence).Select(x => x.Id).ToListAsync());

        var duplicate = Notification(user);
        duplicate.Id = first.Id;
        db.UserNotifications.Add(duplicate);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ADeletedTargetChannelLeavesTheNotificationInTheInbox()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var channel = new Channel { Id = Guid.NewGuid(), ServerId = TestData.ServerId, Name = UniqueName() };
        var notification = Notification(user);
        notification.TargetChannelId = channel.Id;
        notification.TargetInviteCode = "abc123";
        db.Channels.Add(channel);
        db.UserNotifications.Add(notification);
        await db.SaveChangesAsync();

        await db.Channels.Where(x => x.Id == channel.Id).ExecuteDeleteAsync();

        var kept = await db.UserNotifications.AsNoTracking().SingleAsync(x => x.Id == notification.Id);
        Assert.Null(kept.TargetChannelId);
        Assert.Equal("abc123", kept.TargetInviteCode);
        Assert.Equal("Orbit", kept.SourcePackageName);
    }

    [Fact]
    public async Task NotificationsLeaveWithTheirRecipientAndTheirServer()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var server = await AddServerAsync(db);
        var forRecipient = Notification(users[0]);
        var forServer = Notification(users[1]);
        forServer.ServerId = server.Id;
        db.UserNotifications.AddRange(forRecipient, forServer);
        await db.SaveChangesAsync();

        await db.Users.Where(x => x.Id == users[0].Id).ExecuteDeleteAsync();
        await db.Servers.Where(x => x.Id == server.Id).ExecuteDeleteAsync();

        Assert.False(await db.UserNotifications.AnyAsync(x => x.Id == forRecipient.Id));
        Assert.False(await db.UserNotifications.AnyAsync(x => x.Id == forServer.Id));
    }

    [Fact]
    public async Task OperatorSettingsStartFromTheirDefaultsAndBelongToOneServer()
    {
        await using var scope = factory.OpenScope(out var db);
        var server = await AddServerAsync(db);
        db.OperationsSettings.Add(new OperationsSettings { ServerId = server.Id, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var settings = await db.OperationsSettings.SingleAsync(x => x.ServerId == server.Id);
        Assert.Equal("", settings.PublicUrl);
        Assert.Equal("UTC", settings.TimeZone);
        Assert.False(settings.MailingEnabled);
        Assert.True(settings.InviteMailEnabled);
        Assert.True(settings.RecoveryMailEnabled);
        Assert.False(settings.AlertMailEnabled);
        Assert.Equal((14, 30, 1), (settings.BackupRetentionDays, settings.LogRetentionDays, settings.OrphanObjectRetentionDays));
        Assert.True(settings.AutomaticCleanupEnabled);
        Assert.Null(settings.DesktopMinimumVersion);
        Assert.Null(settings.DesktopRecommendedVersion);

        db.ChangeTracker.Clear();
        db.OperationsSettings.Add(new OperationsSettings { ServerId = server.Id, UpdatedAt = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        await db.Servers.Where(x => x.Id == server.Id).ExecuteDeleteAsync();
        Assert.False(await db.OperationsSettings.AnyAsync(x => x.ServerId == server.Id));
    }

    private static async Task<StellarrServer> AddServerAsync(AppDbContext db)
    {
        var server = new StellarrServer { Id = Guid.NewGuid(), Name = UniqueName(), CreatedAt = DateTime.UtcNow };
        db.Servers.Add(server);
        await db.SaveChangesAsync();
        return server;
    }

    private static ServerEmoji Emoji(Guid serverId, User uploader, string shortcode) => new()
    {
        Id = Guid.NewGuid(),
        ServerId = serverId,
        Shortcode = shortcode,
        ObjectKey = $"emoji/{Guid.NewGuid():N}",
        ContentType = "image/png",
        SizeBytes = 2048,
        UploadedById = uploader.Id,
        CreatedAt = DateTime.UtcNow,
    };

    private static SoundboardSound Sound(User creator, ImageAttachment upload) => new()
    {
        Id = Guid.NewGuid(),
        ServerId = TestData.ServerId,
        AttachmentId = upload.Id,
        CreatedById = creator.Id,
        Name = "airhorn",
        Glyph = "x",
        TrimStartSeconds = 0,
        TrimEndSeconds = 2,
        CreatedAt = DateTime.UtcNow,
    };

    private static UserNotification Notification(User recipient) => new()
    {
        Id = Guid.NewGuid(),
        ServerId = TestData.ServerId,
        UserId = recipient.Id,
        Source = "server",
        SourcePackageId = "core",
        SourcePackageName = "Orbit",
        SourceModuleId = "mentions",
        SourceModuleName = "Mentions",
        Title = "You were mentioned",
        Body = "Someone wrote your name",
        Tone = "info",
        CreatedAt = DateTime.UtcNow,
    };
}
