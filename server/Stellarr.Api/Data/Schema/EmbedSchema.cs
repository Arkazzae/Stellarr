using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the link previews of an older installation up to date, and makes
/// every change to them count as a change of their message in the journal
/// that clients resync from.
/// </summary>
internal static class EmbedSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "MessageEmbeds" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_MessageEmbeds" PRIMARY KEY,
                "MessageId" TEXT NOT NULL,
                "Url" TEXT NOT NULL,
                "Kind" INTEGER NOT NULL,
                "Provider" TEXT NOT NULL,
                "ProviderId" TEXT NULL,
                "StartSeconds" INTEGER NULL,
                "Domain" TEXT NOT NULL,
                "Title" TEXT NULL,
                "Description" TEXT NULL,
                "ThumbnailAttachmentId" TEXT NULL,
                "Position" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_MessageEmbeds_Messages_MessageId"
                    FOREIGN KEY ("MessageId") REFERENCES "Messages" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_MessageEmbeds_ImageAttachments_ThumbnailAttachmentId"
                    FOREIGN KEY ("ThumbnailAttachmentId") REFERENCES "ImageAttachments" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_MessageEmbeds_MessageId_Position"
                ON "MessageEmbeds" ("MessageId", "Position");

            CREATE TRIGGER IF NOT EXISTS "MessageEmbeds_Changes_AfterInsert"
            AFTER INSERT ON "MessageEmbeds"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                SELECT "ChannelId", new."MessageId", 0, strftime('%Y-%m-%d %H:%M:%f', 'now')
                FROM "Messages" WHERE "Id" = new."MessageId";
            END;

            CREATE TRIGGER IF NOT EXISTS "MessageEmbeds_Changes_AfterDelete"
            AFTER DELETE ON "MessageEmbeds"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                SELECT "ChannelId", old."MessageId", 0, strftime('%Y-%m-%d %H:%M:%f', 'now')
                FROM "Messages" WHERE "Id" = old."MessageId";
            END;
            """,
            cancellationToken);
}
