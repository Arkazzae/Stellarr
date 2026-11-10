using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the reactions of an older installation up to date, and makes every
/// reaction added or removed count as a change of its message in the journal
/// that clients resync from.
/// </summary>
internal static class MessageReactionSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "MessageReactions" (
                "MessageId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "Emoji" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "PK_MessageReactions" PRIMARY KEY ("MessageId", "UserId", "Emoji"),
                CONSTRAINT "FK_MessageReactions_Messages_MessageId"
                    FOREIGN KEY ("MessageId") REFERENCES "Messages" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_MessageReactions_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_MessageReactions_MessageId_Emoji"
                ON "MessageReactions" ("MessageId", "Emoji");
            CREATE INDEX IF NOT EXISTS "IX_MessageReactions_UserId"
                ON "MessageReactions" ("UserId");

            CREATE TRIGGER IF NOT EXISTS "MessageReactions_Changes_AfterInsert"
            AFTER INSERT ON "MessageReactions"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                SELECT "ChannelId", new."MessageId", 0, strftime('%Y-%m-%d %H:%M:%f', 'now')
                FROM "Messages" WHERE "Id" = new."MessageId";
            END;

            CREATE TRIGGER IF NOT EXISTS "MessageReactions_Changes_AfterDelete"
            AFTER DELETE ON "MessageReactions"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                SELECT "ChannelId", old."MessageId", 0, strftime('%Y-%m-%d %H:%M:%f', 'now')
                FROM "Messages" WHERE "Id" = old."MessageId";
            END;
            """,
            cancellationToken);
}
