using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class AccountSchemaUpgradeTests
{
    [Fact]
    public async Task InitialVolumeGainsProfileColumnsWithoutLosingUsers()
    {
        var path = Path.Combine(Path.GetTempPath(), $"stellarr-profile-upgrade-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;

        try
        {
            var userId = Guid.NewGuid();
            await using (var old = new AppDbContext(options))
            {
                await old.Database.EnsureCreatedAsync();
                old.Users.Add(new User
                {
                    Id = userId,
                    Username = "initial",
                    NormalizedUsername = "INITIAL",
                    DisplayName = "Initial",
                    PasswordHash = new PasswordService().Hash("Initial!2026"),
                    AvatarColor = "#123456",
                    CreatedAt = DateTime.UtcNow,
                });
                await old.SaveChangesAsync();

                // Reproduce the Users table written by the initial release.
                await old.Database.ExecuteSqlRawAsync(
                    """
                    ALTER TABLE "Users" DROP COLUMN "AvatarUrl";
                    ALTER TABLE "Users" DROP COLUMN "BannerUrl";
                    ALTER TABLE "Users" DROP COLUMN "Bio";
                    ALTER TABLE "Users" DROP COLUMN "Pronouns";
                    """);
            }

            await using (var upgraded = new AppDbContext(options))
            {
                await DatabaseSchema.UpgradeAsync(upgraded, CancellationToken.None);

                var user = await upgraded.Users.SingleAsync(x => x.Id == userId);
                Assert.Equal("Initial", user.DisplayName);
                Assert.Null(user.AvatarUrl);
                Assert.Null(user.BannerUrl);
                Assert.Null(user.Bio);
                Assert.Null(user.Pronouns);
            }
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public async Task ExistingVolumeGainsPreferencesWithoutLosingUsers()
    {
        var path = Path.Combine(Path.GetTempPath(), $"stellarr-account-upgrade-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;

        try
        {
            var userId = Guid.NewGuid();
            await using (var old = new AppDbContext(options))
            {
                await old.Database.EnsureCreatedAsync();
                old.Users.Add(new User
                {
                    Id = userId,
                    Username = "upgrade",
                    NormalizedUsername = "UPGRADE",
                    DisplayName = "Upgrade",
                    PasswordHash = new PasswordService().Hash("Upgrade!2026"),
                    AvatarColor = "#123456",
                    AvatarUrl = "/avatars/default-01.svg",
                    BannerUrl = "/banners/maja.svg",
                    CreatedAt = DateTime.UtcNow,
                });
                old.UserPreferences.Add(new UserPreferenceSettings
                {
                    UserId = userId,
                    ReducedMotion = true,
                });
                await old.SaveChangesAsync();

                // Reproduce a preference row from before delivery channels and
                // account-synchronised VAD sensitivity existed.
                await old.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"UserPreferences\" DROP COLUMN \"EmailNotifications\";");
                await old.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"UserPreferences\" DROP COLUMN \"PushNotifications\";");
                await old.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"UserPreferences\" DROP COLUMN \"VadSensitivity\";");
                await old.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"UserPreferences\" DROP COLUMN \"MutedChannelIdsJson\";");
            }

            await using (var upgraded = new AppDbContext(options))
            {
                await DatabaseSchema.UpgradeAsync(upgraded, CancellationToken.None);

                var user = await upgraded.Users.SingleAsync(x => x.Id == userId);
                Assert.Equal("Upgrade", user.DisplayName);
                Assert.Null(user.AvatarUrl);
                Assert.Null(user.BannerUrl);

                var preferences = await upgraded.UserPreferences.SingleAsync();
                Assert.True(preferences.ReducedMotion);
                Assert.False(preferences.EmailNotifications);
                Assert.False(preferences.PushNotifications);
                Assert.Equal("[]", preferences.MutedChannelIdsJson);
                Assert.Equal(60, preferences.VadSensitivity);
            }
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public async Task ExistingVolumeGainsVoiceMessageMarkerWithoutLosingAttachments()
    {
        var path = Path.Combine(Path.GetTempPath(), $"stellarr-attachment-upgrade-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;

        try
        {
            var attachmentId = Guid.NewGuid();
            await using (var old = new AppDbContext(options))
            {
                await old.Database.EnsureCreatedAsync();
                old.ImageAttachments.Add(new ImageAttachment
                {
                    Id = attachmentId,
                    UploadedById = Guid.NewGuid(),
                    ObjectKey = "audio/old.wav",
                    FileName = "old.wav",
                    ContentType = "audio/wav",
                    SizeBytes = 16,
                    CreatedAt = DateTime.UtcNow,
                });
                await old.SaveChangesAsync();
                await old.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"ImageAttachments\" DROP COLUMN \"IsVoiceMessage\";");
            }

            await using (var upgraded = new AppDbContext(options))
            {
                await DatabaseSchema.UpgradeAsync(upgraded, CancellationToken.None);

                var attachment = await upgraded.ImageAttachments.SingleAsync(x => x.Id == attachmentId);
                Assert.False(attachment.IsVoiceMessage);
                attachment.IsVoiceMessage = true;
                await upgraded.SaveChangesAsync();
                Assert.True((await upgraded.ImageAttachments.SingleAsync()).IsVoiceMessage);
            }
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public async Task ExistingVolumeGainsChannelScopedInvites()
    {
        var path = Path.Combine(Path.GetTempPath(), $"stellarr-invite-upgrade-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;

        try
        {
            var userId = Guid.NewGuid();
            var serverId = Guid.NewGuid();
            var channelId = Guid.NewGuid();
            var inviteId = Guid.NewGuid();
            var createdAt = DateTime.UtcNow;
            await using (var old = new AppDbContext(options))
            {
                await old.Database.EnsureCreatedAsync();
                old.Users.Add(new User
                {
                    Id = userId,
                    Username = "invite-upgrade",
                    NormalizedUsername = "INVITE-UPGRADE",
                    DisplayName = "Invite Upgrade",
                    PasswordHash = new PasswordService().Hash("Upgrade!2026"),
                    AvatarColor = "#123456",
                    CreatedAt = createdAt,
                });
                old.Servers.Add(new StellarrServer
                {
                    Id = serverId,
                    Name = "Upgrade",
                    CreatedAt = createdAt,
                });
                old.Channels.Add(new Channel
                {
                    Id = channelId,
                    ServerId = serverId,
                    Name = "rozmowa",
                    Kind = ChannelKind.Voice,
                });
                await old.SaveChangesAsync();

                await old.Database.ExecuteSqlRawAsync(
                    """
                    DROP TABLE "ServerInvites";
                    CREATE TABLE "ServerInvites" (
                        "Id" TEXT NOT NULL CONSTRAINT "PK_ServerInvites" PRIMARY KEY,
                        "ServerId" TEXT NOT NULL,
                        "CreatedById" TEXT NOT NULL,
                        "Code" TEXT NOT NULL,
                        "Uses" INTEGER NOT NULL,
                        "MaxUses" INTEGER NULL,
                        "ExpiresAt" TEXT NULL,
                        "CreatedAt" TEXT NOT NULL,
                        CONSTRAINT "FK_ServerInvites_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                        CONSTRAINT "FK_ServerInvites_Users_CreatedById" FOREIGN KEY ("CreatedById") REFERENCES "Users" ("Id") ON DELETE RESTRICT
                    );
                    CREATE UNIQUE INDEX "IX_ServerInvites_Code" ON "ServerInvites" ("Code");
                    CREATE INDEX "IX_ServerInvites_ServerId" ON "ServerInvites" ("ServerId");
                    """);
                await old.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    INSERT INTO "ServerInvites"
                        ("Id", "ServerId", "CreatedById", "Code", "Uses", "MaxUses", "ExpiresAt", "CreatedAt")
                    VALUES
                        ({inviteId}, {serverId}, {userId}, {"legacy-code"}, {0}, {25}, {createdAt.AddDays(7)}, {createdAt});
                    """);
            }

            await using (var upgraded = new AppDbContext(options))
            {
                await DatabaseSchema.UpgradeAsync(upgraded, CancellationToken.None);

                var invite = await upgraded.ServerInvites.SingleAsync(x => x.Id == inviteId);
                Assert.Null(invite.ChannelId);
                invite.ChannelId = channelId;
                await upgraded.SaveChangesAsync();

                await upgraded.Database.ExecuteSqlInterpolatedAsync(
                    $"DELETE FROM \"Channels\" WHERE \"Id\" = {channelId};");
                upgraded.ChangeTracker.Clear();
                Assert.Null((await upgraded.ServerInvites.SingleAsync(x => x.Id == inviteId)).ChannelId);
            }
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
