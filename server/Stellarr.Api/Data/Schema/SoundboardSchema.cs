using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Adds the sound catalogue and the two playback rules of a server to an
/// installation written before the soundboard existed. On a database created
/// by this build the statements find everything in place.
/// </summary>
internal static class SoundboardSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        if (!await SqliteSchema.HasColumnAsync(db, "Servers", "SoundboardEveryoneCanPlay", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Servers" ADD COLUMN "SoundboardEveryoneCanPlay" INTEGER NOT NULL DEFAULT 1;""",
                cancellationToken);
        }

        if (!await SqliteSchema.HasColumnAsync(db, "Servers", "SoundboardRateLimited", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Servers" ADD COLUMN "SoundboardRateLimited" INTEGER NOT NULL DEFAULT 1;""",
                cancellationToken);
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "SoundboardSounds" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SoundboardSounds" PRIMARY KEY,
                "ServerId" TEXT NOT NULL,
                "AttachmentId" TEXT NOT NULL,
                "CreatedById" TEXT NOT NULL,
                "Name" TEXT NOT NULL,
                "Glyph" TEXT NOT NULL,
                "TrimStartSeconds" REAL NOT NULL,
                "TrimEndSeconds" REAL NOT NULL,
                "Position" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_SoundboardSounds_Servers_ServerId"
                    FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_SoundboardSounds_ImageAttachments_AttachmentId"
                    FOREIGN KEY ("AttachmentId") REFERENCES "ImageAttachments" ("Id") ON DELETE RESTRICT,
                CONSTRAINT "FK_SoundboardSounds_Users_CreatedById"
                    FOREIGN KEY ("CreatedById") REFERENCES "Users" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_SoundboardSounds_ServerId_Position"
                ON "SoundboardSounds" ("ServerId", "Position");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_SoundboardSounds_AttachmentId"
                ON "SoundboardSounds" ("AttachmentId");
            """,
            cancellationToken);
    }
}
