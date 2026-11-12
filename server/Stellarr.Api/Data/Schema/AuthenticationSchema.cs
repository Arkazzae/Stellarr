using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the accounts, sign-in sessions, recovery tokens, desktop browser
/// handoffs and linked identities of an older installation up to date.
/// </summary>
internal static class AuthenticationSchema
{
    private static readonly (string Column, string Statement)[] UserColumns =
    [
        ("Email", """ALTER TABLE "Users" ADD COLUMN "Email" TEXT NULL;"""),
        ("NormalizedEmail", """ALTER TABLE "Users" ADD COLUMN "NormalizedEmail" TEXT NULL;"""),
        ("IsDisabled", """ALTER TABLE "Users" ADD COLUMN "IsDisabled" INTEGER NOT NULL DEFAULT 0;"""),
        ("SessionVersion", """ALTER TABLE "Users" ADD COLUMN "SessionVersion" INTEGER NOT NULL DEFAULT 0;"""),
        ("SecurityRecoveryRequired", """ALTER TABLE "Users" ADD COLUMN "SecurityRecoveryRequired" INTEGER NOT NULL DEFAULT 0;"""),
    ];

    private static readonly (string Column, string Statement)[] SessionColumns =
    [
        ("AbsoluteExpiresAt", """ALTER TABLE "UserSessions" ADD COLUMN "AbsoluteExpiresAt" TEXT NULL;"""),
        ("PrimarySource", """ALTER TABLE "UserSessions" ADD COLUMN "PrimarySource" TEXT NOT NULL DEFAULT 'password';"""),
        ("AuthenticatedAt", """ALTER TABLE "UserSessions" ADD COLUMN "AuthenticatedAt" TEXT NULL;"""),
        ("MfaCompletedAt", """ALTER TABLE "UserSessions" ADD COLUMN "MfaCompletedAt" TEXT NULL;"""),
        ("MfaEvidence", """ALTER TABLE "UserSessions" ADD COLUMN "MfaEvidence" TEXT NULL;"""),
        ("SecurityVersion", """ALTER TABLE "UserSessions" ADD COLUMN "SecurityVersion" INTEGER NOT NULL DEFAULT 0;"""),
        ("ShortLived", """ALTER TABLE "UserSessions" ADD COLUMN "ShortLived" INTEGER NOT NULL DEFAULT 0;"""),
    ];

    private static readonly (string Column, string Statement)[] DesktopColumns =
    [
        ("ApprovalTokenHash", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "ApprovalTokenHash" TEXT NULL;"""),
        ("ApprovalUserId", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "ApprovalUserId" TEXT NULL;"""),
        ("ApprovalSessionId", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "ApprovalSessionId" TEXT NULL;"""),
        ("ApprovedSessionId", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "ApprovedSessionId" TEXT NULL;"""),
        ("PrimarySource", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "PrimarySource" TEXT NULL;"""),
        ("MfaCompletedAt", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "MfaCompletedAt" TEXT NULL;"""),
        ("MfaEvidence", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "MfaEvidence" TEXT NULL;"""),
        ("SecurityVersion", """ALTER TABLE "DesktopBrowserLogins" ADD COLUMN "SecurityVersion" INTEGER NOT NULL DEFAULT 0;"""),
    ];

    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureAccountsAsync(db, cancellationToken);
        await EnsureSessionsAsync(db, cancellationToken);
        await EnsureDesktopBrowserLoginsAsync(db, cancellationToken);
        await EnsureExternalIdentitiesAsync(db, cancellationToken);
    }

    /// <summary>E-mail, session invalidation and one-time recovery tokens.</summary>
    private static async Task EnsureAccountsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        foreach (var (column, statement) in UserColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "Users", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Users_NormalizedEmail"
                ON "Users" ("NormalizedEmail");
            CREATE TABLE IF NOT EXISTS "PasswordResetTokens" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_PasswordResetTokens" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "TokenHash" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "UsedAt" TEXT NULL,
                CONSTRAINT "FK_PasswordResetTokens_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_PasswordResetTokens_TokenHash"
                ON "PasswordResetTokens" ("TokenHash");
            CREATE INDEX IF NOT EXISTS "IX_PasswordResetTokens_UserId_ExpiresAt"
                ON "PasswordResetTokens" ("UserId", "ExpiresAt");
            """,
            cancellationToken);
    }

    private static async Task EnsureSessionsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "UserSessions" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_UserSessions" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "Device" TEXT NOT NULL,
                "IpAddress" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "LastSeenAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "AbsoluteExpiresAt" TEXT NULL,
                "PrimarySource" TEXT NOT NULL DEFAULT 'password',
                "AuthenticatedAt" TEXT NULL,
                "MfaCompletedAt" TEXT NULL,
                "MfaEvidence" TEXT NULL,
                "SecurityVersion" INTEGER NOT NULL DEFAULT 0,
                "RevokedAt" TEXT NULL,
                CONSTRAINT "FK_UserSessions_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_UserSessions_UserId_LastSeenAt"
                ON "UserSessions" ("UserId", "LastSeenAt");
            """,
            cancellationToken);

        foreach (var (column, statement) in SessionColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "UserSessions", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
                if (column == "SecurityVersion")
                {
                    // Existing rows were issued under the user's current version.
                    // Only the migration that adds the column repairs them.
                    await db.Database.ExecuteSqlRawAsync(
                        """
                        UPDATE "UserSessions"
                        SET "SecurityVersion" = COALESCE((
                            SELECT "SessionVersion" FROM "Users"
                            WHERE "Users"."Id" = "UserSessions"."UserId"
                        ), 0);
                        """,
                        cancellationToken);
                }
            }
        }

        // Older sessions keep the end they already had; new sessions get the
        // hard limit when they are created.
        await db.Database.ExecuteSqlRawAsync(
            """
            UPDATE "UserSessions"
            SET "AbsoluteExpiresAt" = "ExpiresAt"
            WHERE "AbsoluteExpiresAt" IS NULL;
            """,
            cancellationToken);
    }

    private static async Task EnsureDesktopBrowserLoginsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "DesktopBrowserLogins" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_DesktopBrowserLogins" PRIMARY KEY,
                "SecretHash" TEXT NOT NULL,
                "ApprovalTokenHash" TEXT NULL,
                "ApprovalUserId" TEXT NULL,
                "ApprovalSessionId" TEXT NULL,
                "UserId" TEXT NULL,
                "ApprovedSessionId" TEXT NULL,
                "PrimarySource" TEXT NULL,
                "MfaCompletedAt" TEXT NULL,
                "MfaEvidence" TEXT NULL,
                "SecurityVersion" INTEGER NOT NULL DEFAULT 0,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "ApprovedAt" TEXT NULL,
                "RedeemedAt" TEXT NULL,
                CONSTRAINT "FK_DesktopBrowserLogins_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_DesktopBrowserLogins_ExpiresAt"
                ON "DesktopBrowserLogins" ("ExpiresAt");
            """,
            cancellationToken);

        foreach (var (column, statement) in DesktopColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "DesktopBrowserLogins", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }

    private static async Task EnsureExternalIdentitiesAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ExternalIdentities" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_ExternalIdentities" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "Issuer" TEXT NOT NULL,
                "Subject" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_ExternalIdentities_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExternalIdentities_Issuer_Subject"
                ON "ExternalIdentities" ("Issuer", "Subject");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExternalIdentities_UserId_Issuer"
                ON "ExternalIdentities" ("UserId", "Issuer");
            """,
            cancellationToken);

        if (!await SqliteSchema.HasColumnAsync(db, "ExternalIdentities", "ProviderId", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "ExternalIdentities" ADD COLUMN "ProviderId" TEXT NULL;""",
                cancellationToken);
        }
    }
}
