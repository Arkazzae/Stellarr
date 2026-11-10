using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Adds the sections of the channel rail to an installation written before
/// they existed. A section is only a label over the server-wide order of the
/// channels, so a channel gains a column and no ordering of its own.
/// </summary>
internal static class SectionSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await EnsureSectionsAsync(db, cancellationToken);

    private static async Task EnsureSectionsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "Sections" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_Sections" PRIMARY KEY,
                "ServerId" TEXT NOT NULL,
                "Name" TEXT NOT NULL,
                "Position" INTEGER NOT NULL,
                CONSTRAINT "FK_Sections_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_Sections_ServerId_Position" ON "Sections" ("ServerId", "Position");
            """,
            cancellationToken);

        if (!await SqliteSchema.HasColumnAsync(db, "Channels", "SectionId", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Channels" ADD COLUMN "SectionId" TEXT NULL;""",
                cancellationToken);
        }
    }
}
