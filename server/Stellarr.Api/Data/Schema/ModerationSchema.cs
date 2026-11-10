using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Adds the table of server bans to an installation written before bans
/// existed. It only creates what is missing: a membership removed by
/// moderation must stay removed across restarts.
/// </summary>
internal static class ModerationSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ServerBans" (
                "ServerId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "BannedById" TEXT NOT NULL,
                "Reason" TEXT NOT NULL,
                "BannedAt" TEXT NOT NULL,
                CONSTRAINT "PK_ServerBans" PRIMARY KEY ("ServerId", "UserId"),
                CONSTRAINT "FK_ServerBans_Servers_ServerId"
                    FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerBans_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerBans_Users_BannedById"
                    FOREIGN KEY ("BannedById") REFERENCES "Users" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_ServerBans_ServerId_BannedAt"
                ON "ServerBans" ("ServerId", "BannedAt");
            CREATE INDEX IF NOT EXISTS "IX_ServerBans_BannedById"
                ON "ServerBans" ("BannedById");
            """,
            cancellationToken);
}
