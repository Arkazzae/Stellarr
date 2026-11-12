using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the owner-managed instance settings of an older installation up to
/// date, with the table of secrets set in Cockpit, which keeps them encrypted.
/// </summary>
internal static class OperationsSchema
{
    // The SMTP settings of an earlier product. They held no secret and nothing
    // reads them. They are dropped so that EF can insert a settings row into an
    // upgraded database without supplying obsolete NOT NULL values.
    private static readonly (string Column, string Statement)[] ObsoleteColumns =
    [
        ("SmtpHost", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpHost";"""),
        ("SmtpPort", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpPort";"""),
        ("SmtpUsername", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpUsername";"""),
        ("SmtpSecurity", """ALTER TABLE "OperationsSettings" DROP COLUMN "SmtpSecurity";"""),
    ];

    // The SMTP columns are named apart from the obsolete ones above, which are
    // dropped on every start; they have defaults, so older rows stay valid.
    private static readonly (string Column, string Statement)[] MailColumns =
    [
        ("MailSmtpHost", """ALTER TABLE "OperationsSettings" ADD COLUMN "MailSmtpHost" TEXT NOT NULL DEFAULT '';"""),
        ("MailSmtpPort", """ALTER TABLE "OperationsSettings" ADD COLUMN "MailSmtpPort" INTEGER NOT NULL DEFAULT 587;"""),
        ("MailSmtpUsername", """ALTER TABLE "OperationsSettings" ADD COLUMN "MailSmtpUsername" TEXT NOT NULL DEFAULT '';"""),
        ("MailSmtpSecurity", """ALTER TABLE "OperationsSettings" ADD COLUMN "MailSmtpSecurity" TEXT NOT NULL DEFAULT 'starttls';"""),
        ("MailResendEnabled", """ALTER TABLE "OperationsSettings" ADD COLUMN "MailResendEnabled" INTEGER NULL;"""),
    ];

    private static readonly (string Column, string Statement)[] IntegrationColumns =
    [
        ("GiphyEnabled", """ALTER TABLE "OperationsSettings" ADD COLUMN "GiphyEnabled" INTEGER NULL;"""),
    ];

    private static readonly (string Column, string Statement)[] DesktopColumns =
    [
        ("DesktopMinimumVersion", """ALTER TABLE "OperationsSettings" ADD COLUMN "DesktopMinimumVersion" TEXT NULL;"""),
        ("DesktopRecommendedVersion", """ALTER TABLE "OperationsSettings" ADD COLUMN "DesktopRecommendedVersion" TEXT NULL;"""),
    ];

    private static readonly (string Column, string Statement)[] SecurityColumns =
    [
        ("MfaRequirement", """ALTER TABLE "OperationsSettings" ADD COLUMN "MfaRequirement" TEXT NOT NULL DEFAULT 'optional';"""),
        ("TrustedDeviceDays", """ALTER TABLE "OperationsSettings" ADD COLUMN "TrustedDeviceDays" INTEGER NOT NULL DEFAULT 14;"""),
        ("AuthChallengeMinutes", """ALTER TABLE "OperationsSettings" ADD COLUMN "AuthChallengeMinutes" INTEGER NOT NULL DEFAULT 5;"""),
        ("EmailCodeMinutes", """ALTER TABLE "OperationsSettings" ADD COLUMN "EmailCodeMinutes" INTEGER NOT NULL DEFAULT 8;"""),
        ("EmailCodeCooldownSeconds", """ALTER TABLE "OperationsSettings" ADD COLUMN "EmailCodeCooldownSeconds" INTEGER NOT NULL DEFAULT 45;"""),
        ("EmailCodeMaxAttempts", """ALTER TABLE "OperationsSettings" ADD COLUMN "EmailCodeMaxAttempts" INTEGER NOT NULL DEFAULT 5;"""),
        ("EmailCodeSendsPerHour", """ALTER TABLE "OperationsSettings" ADD COLUMN "EmailCodeSendsPerHour" INTEGER NOT NULL DEFAULT 10;"""),
        ("CliRecoveryMinutes", """ALTER TABLE "OperationsSettings" ADD COLUMN "CliRecoveryMinutes" INTEGER NOT NULL DEFAULT 10;"""),
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
                "MailSmtpHost" TEXT NOT NULL DEFAULT '',
                "MailSmtpPort" INTEGER NOT NULL DEFAULT 587,
                "MailSmtpUsername" TEXT NOT NULL DEFAULT '',
                "MailSmtpSecurity" TEXT NOT NULL DEFAULT 'starttls',
                "MailResendEnabled" INTEGER NULL,
                "GiphyEnabled" INTEGER NULL,
                "InviteMailEnabled" INTEGER NOT NULL,
                "RecoveryMailEnabled" INTEGER NOT NULL,
                "AlertMailEnabled" INTEGER NOT NULL,
                "BackupRetentionDays" INTEGER NOT NULL,
                "LogRetentionDays" INTEGER NOT NULL,
                "OrphanObjectRetentionDays" INTEGER NOT NULL,
                "AutomaticCleanupEnabled" INTEGER NOT NULL,
                "DesktopMinimumVersion" TEXT NULL,
                "DesktopRecommendedVersion" TEXT NULL,
                "MfaRequirement" TEXT NOT NULL DEFAULT 'optional',
                "TrustedDeviceDays" INTEGER NOT NULL DEFAULT 14,
                "AuthChallengeMinutes" INTEGER NOT NULL DEFAULT 5,
                "EmailCodeMinutes" INTEGER NOT NULL DEFAULT 8,
                "EmailCodeCooldownSeconds" INTEGER NOT NULL DEFAULT 45,
                "EmailCodeMaxAttempts" INTEGER NOT NULL DEFAULT 5,
                "EmailCodeSendsPerHour" INTEGER NOT NULL DEFAULT 10,
                "CliRecoveryMinutes" INTEGER NOT NULL DEFAULT 10,
                "UpdatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_OperationsSettings_Servers_ServerId"
                    FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "InstanceSecrets" (
                "Name" TEXT NOT NULL CONSTRAINT "PK_InstanceSecrets" PRIMARY KEY,
                "ProtectedValue" TEXT NOT NULL,
                "UpdatedAt" TEXT NOT NULL
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

        foreach (var (column, statement) in MailColumns
                     .Concat(IntegrationColumns)
                     .Concat(DesktopColumns)
                     .Concat(SecurityColumns))
        {
            if (!await SqliteSchema.HasColumnAsync(db, "OperationsSettings", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }
}
