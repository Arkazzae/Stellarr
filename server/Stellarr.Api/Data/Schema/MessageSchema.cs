using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the message rows of an older installation up to date. A database
/// created by this build already has everything the model can express, so
/// these steps matter for volumes written before the columns existed.
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
}
