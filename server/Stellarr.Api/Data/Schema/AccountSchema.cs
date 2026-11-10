using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Brings the profile fields and the preferences of an older installation up
/// to date, and clears the artwork that older builds stored as an upload.
/// </summary>
internal static class AccountSchema
{
    private static readonly (string Column, string Statement)[] ProfileColumns =
    [
        ("AvatarUrl", """ALTER TABLE "Users" ADD COLUMN "AvatarUrl" TEXT NULL;"""),
        ("BannerUrl", """ALTER TABLE "Users" ADD COLUMN "BannerUrl" TEXT NULL;"""),
        ("Bio", """ALTER TABLE "Users" ADD COLUMN "Bio" TEXT NULL;"""),
        ("CustomStatus", """ALTER TABLE "Users" ADD COLUMN "CustomStatus" TEXT NULL;"""),
        ("Pronouns", """ALTER TABLE "Users" ADD COLUMN "Pronouns" TEXT NULL;"""),
    ];

    // A preferences table written by an older build lacks the columns that were
    // added to it later, so each one is checked on its own.
    private static readonly (string Column, string Statement)[] PreferenceColumns =
    [
        ("EmailNotifications", """ALTER TABLE "UserPreferences" ADD COLUMN "EmailNotifications" INTEGER NOT NULL DEFAULT 0;"""),
        ("PushNotifications", """ALTER TABLE "UserPreferences" ADD COLUMN "PushNotifications" INTEGER NOT NULL DEFAULT 0;"""),
        // Nullable and without a foreign key, like the property it backs: a
        // chosen sound can outlive the membership that made it selectable, and
        // the hub re-checks that at playback time.
        ("JoinSoundId", """ALTER TABLE "UserPreferences" ADD COLUMN "JoinSoundId" TEXT NULL;"""),
        ("VadSensitivity", """ALTER TABLE "UserPreferences" ADD COLUMN "VadSensitivity" INTEGER NOT NULL DEFAULT 60;"""),
        ("MutedChannelIdsJson", """ALTER TABLE "UserPreferences" ADD COLUMN "MutedChannelIdsJson" TEXT NOT NULL DEFAULT '[]';"""),
    ];

    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureProfileColumnsAsync(db, cancellationToken);
        await EnsurePreferencesAsync(db, cancellationToken);
        await ClearBuiltInIdentityArtAsync(db, cancellationToken);
    }

    private static async Task EnsureProfileColumnsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        foreach (var (column, statement) in ProfileColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "Users", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }

    private static async Task EnsurePreferencesAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "UserPreferences" (
                "UserId" TEXT NOT NULL CONSTRAINT "PK_UserPreferences" PRIMARY KEY,
                "DesktopNotifications" INTEGER NOT NULL DEFAULT 1,
                "EmailNotifications" INTEGER NOT NULL DEFAULT 0,
                "PushNotifications" INTEGER NOT NULL DEFAULT 0,
                "MentionsOnly" INTEGER NOT NULL DEFAULT 1,
                "MessageSound" INTEGER NOT NULL DEFAULT 1,
                "JoinLeaveSound" INTEGER NOT NULL DEFAULT 1,
                "AllowDirectMessages" INTEGER NOT NULL DEFAULT 1,
                "AllowFriendRequests" INTEGER NOT NULL DEFAULT 1,
                "ShowPresence" INTEGER NOT NULL DEFAULT 1,
                "DeveloperMode" INTEGER NOT NULL DEFAULT 0,
                "ReducedMotion" INTEGER NOT NULL DEFAULT 0,
                "MutedChannelIdsJson" TEXT NOT NULL DEFAULT '[]',
                "VadSensitivity" INTEGER NOT NULL DEFAULT 60,
                "JoinSoundId" TEXT NULL,
                CONSTRAINT "FK_UserPreferences_Users_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        foreach (var (column, statement) in PreferenceColumns)
        {
            if (!await SqliteSchema.HasColumnAsync(db, "UserPreferences", column, cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
            }
        }
    }

    /// <summary>
    /// Older versions persisted built-in artwork as though it were an upload.
    /// Clear only the reserved system paths so clients can derive the current
    /// fallback pair from the user id while real /assets/{id} uploads remain
    /// untouched. The named paths belonged to the retired demo accounts.
    /// </summary>
    private static async Task ClearBuiltInIdentityArtAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            UPDATE "Users"
            SET "AvatarUrl" = NULL
            WHERE "AvatarUrl" GLOB '/avatars/default-[0-9][0-9].svg'
               OR "AvatarUrl" IN (
                    '/avatars/ada.svg', '/avatars/ilya.svg', '/avatars/jo.svg',
                    '/avatars/kasia.svg', '/avatars/maja.svg', '/avatars/nils.svg',
                    '/avatars/ola.svg', '/avatars/rafal.svg', '/avatars/tomek.svg',
                    '/avatars/wiktor.svg'
               );

            UPDATE "Users"
            SET "BannerUrl" = NULL
            WHERE "BannerUrl" GLOB '/banners/default-[0-9][0-9].svg'
               OR "BannerUrl" IN (
                    '/banners/ada.svg', '/banners/ilya.svg', '/banners/jo.svg',
                    '/banners/kasia.svg', '/banners/maja.svg', '/banners/nils.svg',
                    '/banners/ola.svg', '/banners/rafal.svg', '/banners/tomek.svg',
                    '/banners/wiktor.svg'
               );
            """,
            cancellationToken);
}
