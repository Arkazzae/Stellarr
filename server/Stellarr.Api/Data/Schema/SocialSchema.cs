using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>
/// Adds friendships, blocks and direct conversations to an installation
/// written before they existed. On a database created by this build the
/// statements find everything in place and change nothing.
/// </summary>
internal static class SocialSchema
{
    internal static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await EnsureTablesAsync(db, cancellationToken);
        await EnsurePairKeyAsync(db, cancellationToken);
        await EnsureDirectMessageAttachmentsAsync(db, cancellationToken);
    }

    private static async Task EnsureTablesAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "Friendships" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_Friendships" PRIMARY KEY,
                "UserAId" TEXT NOT NULL,
                "UserBId" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_Friendships_Users_UserAId" FOREIGN KEY ("UserAId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_Friendships_Users_UserBId" FOREIGN KEY ("UserBId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Friendships_UserAId_UserBId" ON "Friendships" ("UserAId", "UserBId");

            CREATE TABLE IF NOT EXISTS "FriendRequests" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_FriendRequests" PRIMARY KEY,
                "SenderId" TEXT NOT NULL,
                "ReceiverId" TEXT NOT NULL,
                "PairKey" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_FriendRequests_Users_SenderId" FOREIGN KEY ("SenderId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_FriendRequests_Users_ReceiverId" FOREIGN KEY ("ReceiverId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS "UserBlocks" (
                "BlockerId" TEXT NOT NULL,
                "BlockedId" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "PK_UserBlocks" PRIMARY KEY ("BlockerId", "BlockedId"),
                CONSTRAINT "FK_UserBlocks_Users_BlockerId" FOREIGN KEY ("BlockerId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_UserBlocks_Users_BlockedId" FOREIGN KEY ("BlockedId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "DirectConversations" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_DirectConversations" PRIMARY KEY,
                "UserAId" TEXT NOT NULL,
                "UserBId" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_DirectConversations_Users_UserAId" FOREIGN KEY ("UserAId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_DirectConversations_Users_UserBId" FOREIGN KEY ("UserBId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_DirectConversations_UserAId_UserBId" ON "DirectConversations" ("UserAId", "UserBId");

            CREATE TABLE IF NOT EXISTS "DirectMessages" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_DirectMessages" PRIMARY KEY,
                "ConversationId" TEXT NOT NULL,
                "AuthorId" TEXT NOT NULL,
                "Content" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_DirectMessages_DirectConversations_ConversationId" FOREIGN KEY ("ConversationId") REFERENCES "DirectConversations" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_DirectMessages_Users_AuthorId" FOREIGN KEY ("AuthorId") REFERENCES "Users" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_DirectMessages_ConversationId_CreatedAt" ON "DirectMessages" ("ConversationId", "CreatedAt");

            CREATE TABLE IF NOT EXISTS "DirectConversationReads" (
                "ConversationId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "LastReadAt" TEXT NOT NULL,
                CONSTRAINT "PK_DirectConversationReads" PRIMARY KEY ("ConversationId", "UserId"),
                CONSTRAINT "FK_DirectConversationReads_DirectConversations_ConversationId" FOREIGN KEY ("ConversationId") REFERENCES "DirectConversations" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_DirectConversationReads_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

    /// <summary>
    /// The first friend requests had no pair key and could point both ways
    /// between two people, so the older of the two is kept before the unique
    /// index that allows one request per pair is added.
    /// </summary>
    private static async Task EnsurePairKeyAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        if (!await SqliteSchema.HasColumnAsync(db, "FriendRequests", "PairKey", cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                """
                DELETE FROM "FriendRequests"
                WHERE rowid NOT IN (
                    SELECT MIN(rowid)
                    FROM "FriendRequests"
                    GROUP BY
                        CASE WHEN "SenderId" < "ReceiverId" THEN "SenderId" ELSE "ReceiverId" END,
                        CASE WHEN "SenderId" < "ReceiverId" THEN "ReceiverId" ELSE "SenderId" END
                );
                ALTER TABLE "FriendRequests" ADD COLUMN "PairKey" TEXT NULL;
                UPDATE "FriendRequests"
                SET "PairKey" = CASE
                    WHEN "SenderId" < "ReceiverId" THEN "SenderId" || ':' || "ReceiverId"
                    ELSE "ReceiverId" || ':' || "SenderId"
                END;
                """,
                cancellationToken);
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_FriendRequests_PairKey"
                ON "FriendRequests" ("PairKey");
            """,
            cancellationToken);
    }

    private static async Task EnsureDirectMessageAttachmentsAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "DirectMessageAttachments" (
                "DirectMessageId" TEXT NOT NULL,
                "AttachmentId" TEXT NOT NULL,
                CONSTRAINT "PK_DirectMessageAttachments" PRIMARY KEY ("DirectMessageId", "AttachmentId"),
                CONSTRAINT "FK_DirectMessageAttachments_DirectMessages_DirectMessageId"
                    FOREIGN KEY ("DirectMessageId") REFERENCES "DirectMessages" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_DirectMessageAttachments_ImageAttachments_AttachmentId"
                    FOREIGN KEY ("AttachmentId") REFERENCES "ImageAttachments" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_DirectMessageAttachments_AttachmentId"
                ON "DirectMessageAttachments" ("AttachmentId");
            """,
            cancellationToken);
}
