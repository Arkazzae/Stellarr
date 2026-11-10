using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the roles, memberships, server profile, channel settings and read
/// markers of an older installation up to date.
/// </summary>
internal static class ServerSchema
{
    private static readonly (string Table, string Column, string Statement)[] AddedColumns =
    [
        ("Channels", "Topic", """ALTER TABLE "Channels" ADD COLUMN "Topic" TEXT NOT NULL DEFAULT '';"""),
        (
            "Channels",
            "SlowModeSeconds",
            """ALTER TABLE "Channels" ADD COLUMN "SlowModeSeconds" INTEGER NOT NULL DEFAULT 0;"""),
        (
            "Channels",
            "HideAfterInactivityHours",
            """ALTER TABLE "Channels" ADD COLUMN "HideAfterInactivityHours" INTEGER NOT NULL DEFAULT 0;"""),
        (
            "Channels",
            "AudioProfile",
            """ALTER TABLE "Channels" ADD COLUMN "AudioProfile" TEXT NOT NULL DEFAULT 'premium';"""),
        ("Channels", "UserLimit", """ALTER TABLE "Channels" ADD COLUMN "UserLimit" INTEGER NOT NULL DEFAULT 0;"""),
        ("Servers", "Description", """ALTER TABLE "Servers" ADD COLUMN "Description" TEXT NOT NULL DEFAULT '';"""),
        ("Servers", "IsPublic", """ALTER TABLE "Servers" ADD COLUMN "IsPublic" INTEGER NOT NULL DEFAULT 0;"""),
    ];

    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureRolesAndMembershipsAsync(db, cancellationToken);
        await EnsureOwnerSlotsAsync(db, cancellationToken);
        await EnsureServerAndChannelColumnsAsync(db, cancellationToken);
        await EnsureChannelReadsAsync(db, cancellationToken);
    }

    private static async Task EnsureRolesAndMembershipsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ServerRoles" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_ServerRoles" PRIMARY KEY,
                "ServerId" TEXT NOT NULL,
                "Name" TEXT NOT NULL,
                "Color" TEXT NOT NULL,
                "Permissions" INTEGER NOT NULL,
                "Position" INTEGER NOT NULL,
                "IsSystem" INTEGER NOT NULL,
                "IsOwner" INTEGER NOT NULL,
                CONSTRAINT "FK_ServerRoles_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ServerRoles_ServerId_Name" ON "ServerRoles" ("ServerId", "Name");

            CREATE TABLE IF NOT EXISTS "ServerMembers" (
                "ServerId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "RoleId" TEXT NOT NULL,
                "JoinedAt" TEXT NOT NULL,
                CONSTRAINT "PK_ServerMembers" PRIMARY KEY ("ServerId", "UserId"),
                CONSTRAINT "FK_ServerMembers_Servers_ServerId" FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerMembers_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ServerMembers_ServerRoles_RoleId" FOREIGN KEY ("RoleId") REFERENCES "ServerRoles" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_ServerMembers_RoleId" ON "ServerMembers" ("RoleId");
            """,
            cancellationToken);

        if (!await SqliteSchema.HasColumnAsync(db, "ServerMembers", "OwnerSlot", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "ServerMembers" ADD COLUMN "OwnerSlot" INTEGER NULL;""",
                cancellationToken);
        }
    }

    /// <summary>
    /// Makes "one owner per server" a rule of the database. Older builds could
    /// briefly create two owners through concurrent transfers, so the earliest
    /// membership is kept as the owner and any extra moves to the built-in
    /// member role before the unique index goes in. The slots are rewritten on
    /// every start, so a hand-edited database finds its way back.
    /// </summary>
    private static async Task EnsureOwnerSlotsAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            UPDATE "ServerMembers" AS member
            SET "RoleId" = (
                SELECT fallback."Id"
                FROM "ServerRoles" AS fallback
                WHERE fallback."ServerId" = member."ServerId"
                  AND fallback."IsSystem" = 1
                  AND fallback."IsOwner" = 0
                ORDER BY fallback."Position" DESC
                LIMIT 1
            )
            WHERE member."RoleId" IN (
                SELECT ownerRole."Id" FROM "ServerRoles" AS ownerRole
                WHERE ownerRole."IsOwner" = 1
            )
              AND member."UserId" <> (
                SELECT canonical."UserId"
                FROM "ServerMembers" AS canonical
                JOIN "ServerRoles" AS canonicalRole ON canonicalRole."Id" = canonical."RoleId"
                WHERE canonical."ServerId" = member."ServerId"
                  AND canonicalRole."IsOwner" = 1
                ORDER BY canonical."JoinedAt", canonical."UserId"
                LIMIT 1
            );

            UPDATE "ServerMembers"
            SET "OwnerSlot" = CASE
                WHEN "RoleId" IN (SELECT "Id" FROM "ServerRoles" WHERE "IsOwner" = 1) THEN 1
                ELSE NULL
            END;

            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ServerMembers_ServerId_OwnerSlot"
                ON "ServerMembers" ("ServerId", "OwnerSlot");
            """,
            cancellationToken);

    private static async Task EnsureServerAndChannelColumnsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        foreach (var (table, column, statement) in AddedColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, table, column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }

    private static async Task EnsureChannelReadsAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "ChannelReads" (
                "ChannelId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "LastReadAt" TEXT NOT NULL,
                CONSTRAINT "PK_ChannelReads" PRIMARY KEY ("ChannelId", "UserId"),
                CONSTRAINT "FK_ChannelReads_Channels_ChannelId"
                    FOREIGN KEY ("ChannelId") REFERENCES "Channels" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ChannelReads_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_ChannelReads_UserId"
                ON "ChannelReads" ("UserId");
            """,
            cancellationToken);
}
