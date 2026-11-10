using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the server icon, and the invites, audit log and notification
/// settings that server administrators use, up to date on an installation
/// written by an older build.
/// </summary>
internal static class ServerAdministrationSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureIconAsync(db, cancellationToken);
        await EnsureAdministrationTablesAsync(db, cancellationToken);
        await EnsureInviteChannelAsync(db, cancellationToken);
    }

    private static async Task EnsureIconAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        if (!await SqliteSchema.HasColumnAsync(db, "Servers", "IconUrl", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Servers" ADD COLUMN "IconUrl" TEXT NULL;""",
                cancellationToken);
        }
    }

    private static async Task EnsureAdministrationTablesAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ServerInvites" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_ServerInvites" PRIMARY KEY,
                "ServerId" TEXT NOT NULL, "CreatedById" TEXT NOT NULL,
                "ChannelId" TEXT NULL,
                "Code" TEXT NOT NULL, "Uses" INTEGER NOT NULL,
                "MaxUses" INTEGER NULL, "ExpiresAt" TEXT NULL, "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_ServerInvites_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerInvites_Users_CreatedById" FOREIGN KEY ("CreatedById") REFERENCES "Users" ("Id") ON DELETE RESTRICT,
                CONSTRAINT "FK_ServerInvites_Channels_ChannelId" FOREIGN KEY ("ChannelId") REFERENCES "Channels" ("Id") ON DELETE SET NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ServerInvites_Code" ON "ServerInvites" ("Code");
            CREATE INDEX IF NOT EXISTS "IX_ServerInvites_ServerId" ON "ServerInvites" ("ServerId");

            CREATE TABLE IF NOT EXISTS "ServerAuditEntries" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_ServerAuditEntries" PRIMARY KEY,
                "ServerId" TEXT NOT NULL, "ActorId" TEXT NOT NULL,
                "Summary" TEXT NOT NULL, "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_ServerAuditEntries_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerAuditEntries_Users_ActorId" FOREIGN KEY ("ActorId") REFERENCES "Users" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_ServerAuditEntries_ServerId_CreatedAt" ON "ServerAuditEntries" ("ServerId", "CreatedAt");
            CREATE INDEX IF NOT EXISTS "IX_ServerAuditEntries_ActorId" ON "ServerAuditEntries" ("ActorId");

            CREATE TABLE IF NOT EXISTS "ServerAdminSettings" (
                "ServerId" TEXT NOT NULL CONSTRAINT "PK_ServerAdminSettings" PRIMARY KEY,
                "AllMessages" INTEGER NOT NULL DEFAULT 0,
                "MentionsOnly" INTEGER NOT NULL DEFAULT 1,
                "VoiceJoinSound" INTEGER NOT NULL DEFAULT 1,
                "MutedChannelIdsJson" TEXT NOT NULL DEFAULT '[]',
                "ServerMuted" INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT "FK_ServerAdminSettings_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

    /// <summary>
    /// Invites used to be valid for the whole server. One may now name the
    /// channel its new member lands in; the column empties when that channel
    /// is deleted.
    /// </summary>
    private static async Task EnsureInviteChannelAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        if (!await SqliteSchema.HasColumnAsync(db, "ServerInvites", "ChannelId", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "ServerInvites" ADD COLUMN "ChannelId" TEXT NULL REFERENCES "Channels" ("Id") ON DELETE SET NULL;""",
                cancellationToken);
        }

        await db.Database.ExecuteSqlRawAsync(
            """CREATE INDEX IF NOT EXISTS "IX_ServerInvites_ChannelId" ON "ServerInvites" ("ChannelId");""",
            cancellationToken);
    }
}
