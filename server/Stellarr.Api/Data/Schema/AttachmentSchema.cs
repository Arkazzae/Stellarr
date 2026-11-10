using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the attachment rows and the queue of stored objects awaiting
/// deletion of an older installation up to date.
/// </summary>
internal static class AttachmentSchema
{
    private static readonly (string Column, string Statement)[] AddedColumns =
    [
        ("DurationSeconds", """ALTER TABLE "ImageAttachments" ADD COLUMN "DurationSeconds" REAL NULL;"""),
        ("PosterObjectKey", """ALTER TABLE "ImageAttachments" ADD COLUMN "PosterObjectKey" TEXT NULL;"""),
        ("PosterContentType", """ALTER TABLE "ImageAttachments" ADD COLUMN "PosterContentType" TEXT NULL;"""),
        ("PosterSizeBytes", """ALTER TABLE "ImageAttachments" ADD COLUMN "PosterSizeBytes" INTEGER NULL;"""),
        (
            "IsVoiceMessage",
            """ALTER TABLE "ImageAttachments" ADD COLUMN "IsVoiceMessage" INTEGER NOT NULL DEFAULT 0;"""),
    ];

    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureObjectDeletionQueueAsync(db, cancellationToken);
        await EnsureAttachmentMetadataAsync(db, cancellationToken);
    }

    private static async Task EnsureObjectDeletionQueueAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ObjectDeletions" (
                "ObjectKey" TEXT NOT NULL CONSTRAINT "PK_ObjectDeletions" PRIMARY KEY,
                "QueuedAt" TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_ObjectDeletions_QueuedAt"
                ON "ObjectDeletions" ("QueuedAt");
            """,
            cancellationToken);

    /// <summary>Adds the measured media properties and the poster to attachments of older volumes.</summary>
    private static async Task EnsureAttachmentMetadataAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        foreach (var (column, statement) in AddedColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "ImageAttachments", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }
}
