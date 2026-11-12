using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Creates the account-security records of an installation that predates MFA.
/// Every statement is idempotent and keeps old rows valid.
/// </summary>
internal static class SecuritySchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "MfaMethods" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_MfaMethods" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "Type" TEXT NOT NULL,
                "Name" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ConfirmedAt" TEXT NULL,
                "LastUsedAt" TEXT NULL,
                "ProtectedSecret" TEXT NULL,
                "EmailAddress" TEXT NULL,
                "LastTotpStep" INTEGER NULL,
                "RevokedAt" TEXT NULL,
                CONSTRAINT "FK_MfaMethods_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_MfaMethods_UserId_RevokedAt"
                ON "MfaMethods" ("UserId", "RevokedAt");

            CREATE TABLE IF NOT EXISTS "RecoveryCodes" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_RecoveryCodes" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "BatchId" TEXT NOT NULL,
                "CodeHash" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "UsedAt" TEXT NULL,
                CONSTRAINT "FK_RecoveryCodes_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_RecoveryCodes_CodeHash"
                ON "RecoveryCodes" ("CodeHash");
            CREATE INDEX IF NOT EXISTS "IX_RecoveryCodes_UserId_BatchId"
                ON "RecoveryCodes" ("UserId", "BatchId");

            CREATE TABLE IF NOT EXISTS "TrustedDevices" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_TrustedDevices" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "TokenHash" TEXT NOT NULL,
                "Name" TEXT NOT NULL,
                "Device" TEXT NOT NULL,
                "IpAddress" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "LastUsedAt" TEXT NULL,
                "RevokedAt" TEXT NULL,
                CONSTRAINT "FK_TrustedDevices_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_TrustedDevices_TokenHash"
                ON "TrustedDevices" ("TokenHash");
            CREATE INDEX IF NOT EXISTS "IX_TrustedDevices_UserId_ExpiresAt"
                ON "TrustedDevices" ("UserId", "ExpiresAt");

            CREATE TABLE IF NOT EXISTS "AuthChallenges" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_AuthChallenges" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "Purpose" TEXT NOT NULL,
                "SecretHash" TEXT NOT NULL,
                "PrimarySource" TEXT NOT NULL,
                "ParentSessionId" TEXT NULL,
                "SecurityVersion" INTEGER NOT NULL,
                "Attempts" INTEGER NOT NULL,
                "MaxAttempts" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "ConsumedAt" TEXT NULL,
                CONSTRAINT "FK_AuthChallenges_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_AuthChallenges_UserId_Purpose_ExpiresAt"
                ON "AuthChallenges" ("UserId", "Purpose", "ExpiresAt");

            CREATE TABLE IF NOT EXISTS "EmailOtpCodes" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_EmailOtpCodes" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "MethodId" TEXT NULL,
                "ChallengeId" TEXT NULL,
                "Purpose" TEXT NOT NULL,
                "EmailAddress" TEXT NOT NULL,
                "ProtectedCode" TEXT NOT NULL,
                "Attempts" INTEGER NOT NULL,
                "MaxAttempts" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "ConsumedAt" TEXT NULL,
                "DeliveredAt" TEXT NULL,
                CONSTRAINT "FK_EmailOtpCodes_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_EmailOtpCodes_UserId_Purpose_CreatedAt"
                ON "EmailOtpCodes" ("UserId", "Purpose", "CreatedAt");

            CREATE TABLE IF NOT EXISTS "CliRecoveryCredentials" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_CliRecoveryCredentials" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "TokenHash" TEXT NOT NULL,
                "Reason" TEXT NOT NULL,
                "SecurityVersion" INTEGER NOT NULL DEFAULT 0,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "UsedAt" TEXT NULL,
                CONSTRAINT "FK_CliRecoveryCredentials_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_CliRecoveryCredentials_TokenHash"
                ON "CliRecoveryCredentials" ("TokenHash");
            CREATE INDEX IF NOT EXISTS "IX_CliRecoveryCredentials_UserId_ExpiresAt"
                ON "CliRecoveryCredentials" ("UserId", "ExpiresAt");

            CREATE TABLE IF NOT EXISTS "SecurityEvents" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SecurityEvents" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "Kind" TEXT NOT NULL,
                "Detail" TEXT NOT NULL,
                "IpAddress" TEXT NOT NULL,
                "Device" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_SecurityEvents_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_SecurityEvents_UserId_CreatedAt"
                ON "SecurityEvents" ("UserId", "CreatedAt");

            CREATE TABLE IF NOT EXISTS "SecurityNotifications" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SecurityNotifications" PRIMARY KEY,
                "SecurityEventId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "EmailAddress" TEXT NOT NULL,
                "Attempts" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "NextAttemptAt" TEXT NOT NULL,
                "LastAttemptAt" TEXT NULL,
                "SentAt" TEXT NULL,
                "LastError" TEXT NOT NULL,
                CONSTRAINT "FK_SecurityNotifications_SecurityEvents_SecurityEventId"
                    FOREIGN KEY ("SecurityEventId") REFERENCES "SecurityEvents" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_SecurityNotifications_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE NO ACTION
            );
            CREATE INDEX IF NOT EXISTS "IX_SecurityNotifications_SentAt_NextAttemptAt"
                ON "SecurityNotifications" ("SentAt", "NextAttemptAt");
            """,
            cancellationToken);

        // Stage-one volumes created before a challenge binding or credential
        // versioning existed gain the columns without losing their rows.
        if (!await SqliteSchema.HasColumnAsync(db, "EmailOtpCodes", "ChallengeId", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "EmailOtpCodes" ADD COLUMN "ChallengeId" TEXT NULL;""",
                cancellationToken);
        }

        if (!await SqliteSchema.HasColumnAsync(db, "CliRecoveryCredentials", "SecurityVersion", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "CliRecoveryCredentials" ADD COLUMN "SecurityVersion" INTEGER NOT NULL DEFAULT 0;""",
                cancellationToken);
        }

        if (!await SqliteSchema.HasColumnAsync(db, "AuthChallenges", "ParentSessionId", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "AuthChallenges" ADD COLUMN "ParentSessionId" TEXT NULL;""",
                cancellationToken);
        }

        if (!await SqliteSchema.HasColumnAsync(db, "AuthChallenges", "ShortLived", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "AuthChallenges" ADD COLUMN "ShortLived" INTEGER NOT NULL DEFAULT 0;""",
                cancellationToken);
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_EmailOtpCodes_ChallengeId_Purpose"
                ON "EmailOtpCodes" ("ChallengeId", "Purpose");
            """,
            cancellationToken);
    }
}
