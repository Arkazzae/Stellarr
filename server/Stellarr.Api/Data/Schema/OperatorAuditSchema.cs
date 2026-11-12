using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Adds the audit of changes made from the local operator CLI. The CLI only
/// checks that this table exists; a normal API start is what creates it.
/// </summary>
internal static class OperatorAuditSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "OperatorAuditEntries" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_OperatorAuditEntries" PRIMARY KEY,
                "Actor" TEXT NOT NULL,
                "Operation" TEXT NOT NULL,
                "Target" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL
            );
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_OperatorAuditEntries_CreatedAt"
                ON "OperatorAuditEntries" ("CreatedAt");
            """,
            cancellationToken);
    }
}
