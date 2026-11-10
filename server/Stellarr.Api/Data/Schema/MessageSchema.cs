using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the message rows of an older installation up to date and keeps the
/// journal of changes that clients replay after a dropped connection. A
/// database created by this build already has every table and column the
/// model can express, so on those the steps only add the triggers.
/// </summary>
internal static class MessageSchema
{
    /// <remarks>
    /// Nullable without a default where a null already says the right thing:
    /// a message written before editing or pinning was never edited or pinned.
    /// </remarks>
    private static readonly (string Column, string Statement)[] AddedColumns =
    [
        ("EditedAt", """ALTER TABLE "Messages" ADD COLUMN "EditedAt" TEXT NULL;"""),
        ("PinnedAt", """ALTER TABLE "Messages" ADD COLUMN "PinnedAt" TEXT NULL;"""),
        ("IsSystem", """ALTER TABLE "Messages" ADD COLUMN "IsSystem" INTEGER NOT NULL DEFAULT 0;"""),
        (
            "ReplyToMessageId",
            """
            ALTER TABLE "Messages" ADD COLUMN "ReplyToMessageId" TEXT NULL REFERENCES "Messages" ("Id") ON DELETE SET NULL;
            """),
    ];

    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await RetireDomainEventTriggersAsync(db, cancellationToken);
        await EnsureColumnsAsync(db, cancellationToken);
        await EnsureJournalAsync(db, cancellationToken);
    }

    /// <summary>
    /// Earlier builds copied every message and reaction, deleted ones
    /// included, into a table of domain events through these triggers. Nothing
    /// reads or prunes that table any more, so the copying stops here.
    /// </summary>
    private static async Task RetireDomainEventTriggersAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP TRIGGER IF EXISTS "Messages_SdkDomainEvents_AfterInsert";
            DROP TRIGGER IF EXISTS "Messages_SdkDomainEvents_AfterUpdate";
            DROP TRIGGER IF EXISTS "Messages_SdkDomainEvents_AfterDelete";
            DROP TRIGGER IF EXISTS "MessageReactions_SdkDomainEvents_AfterInsert";
            DROP TRIGGER IF EXISTS "MessageReactions_SdkDomainEvents_AfterDelete";
            """,
            cancellationToken);

    private static async Task EnsureColumnsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        foreach (var (column, statement) in AddedColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "Messages", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_Messages_ChannelId_PinnedAt"
                ON "Messages" ("ChannelId", "PinnedAt");
            CREATE INDEX IF NOT EXISTS "IX_Messages_ReplyToMessageId"
                ON "Messages" ("ReplyToMessageId");
            """,
            cancellationToken);
    }

    /// <summary>
    /// Records changes to messages in a table of their own, from triggers
    /// rather than from the endpoints, so that every writer is covered. The
    /// triggers on reactions and embeds are created next to their tables.
    /// </summary>
    private static async Task EnsureJournalAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "MessageChanges" (
                "Sequence" INTEGER NOT NULL CONSTRAINT "PK_MessageChanges" PRIMARY KEY AUTOINCREMENT,
                "ChannelId" TEXT NOT NULL,
                "MessageId" TEXT NOT NULL,
                "Kind" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_MessageChanges_ChannelId_Sequence"
                ON "MessageChanges" ("ChannelId", "Sequence");

            CREATE TRIGGER IF NOT EXISTS "Messages_Changes_AfterInsert"
            AFTER INSERT ON "Messages"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                VALUES (new."ChannelId", new."Id", 0, strftime('%Y-%m-%d %H:%M:%f', 'now'));
            END;

            CREATE TRIGGER IF NOT EXISTS "Messages_Changes_AfterUpdate"
            AFTER UPDATE OF "Content", "EditedAt", "PinnedAt" ON "Messages"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                VALUES (new."ChannelId", new."Id", 0, strftime('%Y-%m-%d %H:%M:%f', 'now'));
            END;

            CREATE TRIGGER IF NOT EXISTS "Messages_Changes_AfterDelete"
            AFTER DELETE ON "Messages"
            BEGIN
                INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
                VALUES (old."ChannelId", old."Id", 1, strftime('%Y-%m-%d %H:%M:%f', 'now'));
            END;

            CREATE TRIGGER IF NOT EXISTS "Channels_Changes_AfterDelete"
            AFTER DELETE ON "Channels"
            BEGIN
                DELETE FROM "MessageChanges" WHERE "ChannelId" = old."Id";
            END;
            """,
            cancellationToken);
}
