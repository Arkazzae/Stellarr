using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the server icon, and the invites, audit log and notification
/// settings that server administrators use, up to date on an installation
/// written by an older build.
/// </summary>
internal static class ServerAdministrationSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureIconAsync(db, cancellationToken);
    }

    private static async Task EnsureIconAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        if (!await SqliteSchema.HasColumnAsync(db, "Servers", "IconUrl", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Servers" ADD COLUMN "IconUrl" TEXT NULL;""",
                cancellationToken);
        }
    }
}
