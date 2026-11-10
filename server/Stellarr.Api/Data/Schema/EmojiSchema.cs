using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Adds custom emoji storage to an installation written before it existed. On
/// a database created by this build the statements find everything in place.
/// </summary>
internal static class EmojiSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ServerEmoji" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_ServerEmoji" PRIMARY KEY,
                "ServerId" TEXT NOT NULL,
                "Shortcode" TEXT NOT NULL,
                "ObjectKey" TEXT NOT NULL,
                "ContentType" TEXT NOT NULL,
                "SizeBytes" INTEGER NOT NULL,
                "UploadedById" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_ServerEmoji_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerEmoji_Users_UploadedById" FOREIGN KEY ("UploadedById") REFERENCES "Users" ("Id") ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ServerEmoji_ServerId_Shortcode" ON "ServerEmoji" ("ServerId", "Shortcode");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ServerEmoji_ObjectKey" ON "ServerEmoji" ("ObjectKey");
            CREATE INDEX IF NOT EXISTS "IX_ServerEmoji_UploadedById" ON "ServerEmoji" ("UploadedById");
            """,
            cancellationToken);
}
