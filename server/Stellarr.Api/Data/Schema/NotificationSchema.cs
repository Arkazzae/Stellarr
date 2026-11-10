using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>Brings the notification inbox of an older installation up to date.</summary>
internal static class NotificationSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "UserNotifications" (
                "Sequence" INTEGER NOT NULL CONSTRAINT "PK_UserNotifications" PRIMARY KEY AUTOINCREMENT,
                "Id" TEXT NOT NULL,
                "ServerId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "Source" TEXT NOT NULL,
                "SourcePackageId" TEXT NOT NULL,
                "SourcePackageName" TEXT NOT NULL,
                "SourceModuleId" TEXT NOT NULL,
                "SourceModuleName" TEXT NOT NULL,
                "Title" TEXT NOT NULL,
                "Body" TEXT NOT NULL,
                "Tone" TEXT NOT NULL,
                "TargetChannelId" TEXT NULL,
                "TargetInviteCode" TEXT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ReadAt" TEXT NULL,
                CONSTRAINT "FK_UserNotifications_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_UserNotifications_Servers_ServerId"
                    FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_UserNotifications_Channels_TargetChannelId"
                    FOREIGN KEY ("TargetChannelId") REFERENCES "Channels" ("Id") ON DELETE SET NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserNotifications_Id"
                ON "UserNotifications" ("Id");
            CREATE INDEX IF NOT EXISTS "IX_UserNotifications_ServerId_UserId_Sequence"
                ON "UserNotifications" ("ServerId", "UserId", "Sequence");
            CREATE INDEX IF NOT EXISTS "IX_UserNotifications_ServerId_UserId_ReadAt_Sequence"
                ON "UserNotifications" ("ServerId", "UserId", "ReadAt", "Sequence");
            CREATE INDEX IF NOT EXISTS "IX_UserNotifications_UserId_ReadAt_Sequence"
                ON "UserNotifications" ("UserId", "ReadAt", "Sequence");
            """,
            cancellationToken);

        // An invitation can be the target of a notification, which a table
        // from before invitations existed has no column for.
        if (!await SqliteSchema.HasColumnAsync(db, "UserNotifications", "TargetInviteCode", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "UserNotifications" ADD COLUMN "TargetInviteCode" TEXT NULL;""",
                cancellationToken);
        }
    }
}
