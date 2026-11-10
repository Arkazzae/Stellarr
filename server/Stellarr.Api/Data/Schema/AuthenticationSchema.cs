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

    private static async Task EnsureSessionsAsync(AppDbContext db, CancellationToken cancellationToken) =>
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
                "RevokedAt" TEXT NULL,
                CONSTRAINT "FK_UserSessions_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_UserSessions_UserId_LastSeenAt"
                ON "UserSessions" ("UserId", "LastSeenAt");
            """,
            cancellationToken);

    private static async Task EnsureDesktopBrowserLoginsAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "DesktopBrowserLogins" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_DesktopBrowserLogins" PRIMARY KEY,
                "SecretHash" TEXT NOT NULL,
                "UserId" TEXT NULL,
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

    private static async Task EnsureExternalIdentitiesAsync(AppDbContext db, CancellationToken cancellationToken) =>
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
}
