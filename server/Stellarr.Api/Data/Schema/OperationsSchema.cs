using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the owner-managed instance settings of an older installation up to
/// date. The mail provider's API key is not part of them; it stays in the
/// environment.
/// </summary>
internal static class OperationsSchema
{
    // SMTP was replaced by the Resend HTTPS API. These columns held no secret
    // and nothing reads them. They are dropped so that EF can insert a settings
    // row into an upgraded database without supplying obsolete NOT NULL values.
    private static readonly (string Column, string Statement)[] ObsoleteColumns =
    [
        ("SmtpHost", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpHost";"""),
        ("SmtpPort", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpPort";"""),
        ("SmtpUsername", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpUsername";"""),
        ("SmtpSecurity", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpSecurity";"""),
    ];

    private static readonly (string Column, string Statement)[] DesktopColumns =
    [
        ("DesktopMinimumVersion", """ALTER TABLE "OperationsSettings" ADD COLUMN "DesktopMinimumVersion" TEXT NULL;"""),
        ("DesktopRecommendedVersion", """ALTER TABLE "OperationsSettings" ADD COLUMN "DesktopRecommendedVersion" TEXT NULL;"""),
    ];

    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "OperationsSettings" (
                "ServerId" TEXT NOT NULL CONSTRAINT "PK_OperationsSettings" PRIMARY KEY,
                "PublicUrl" TEXT NOT NULL,
                "TimeZone" TEXT NOT NULL,
                "MailingEnabled" INTEGER NOT NULL,
                "MailFromAddress" TEXT NOT NULL,
                "InviteMailEnabled" INTEGER NOT NULL,
                "RecoveryMailEnabled" INTEGER NOT NULL,
                "AlertMailEnabled" INTEGER NOT NULL,
                "BackupRetentionDays" INTEGER NOT NULL,
                "LogRetentionDays" INTEGER NOT NULL,
                "OrphanObjectRetentionDays" INTEGER NOT NULL,
                "AutomaticCleanupEnabled" INTEGER NOT NULL,
                "DesktopMinimumVersion" TEXT NULL,
                "DesktopRecommendedVersion" TEXT NULL,
                "UpdatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_OperationsSettings_Servers_ServerId"
                    FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        foreach (var (column, statement) in ObsoleteColumns)
        {
            if (await SqliteSchema.HasColumnAsync(db, "OperationsSettings", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }

        foreach (var (column, statement) in DesktopColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "OperationsSettings", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }
}
