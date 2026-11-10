using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class DatabaseSchemaTests
{
    [Fact]
    public async Task UpgradeAddsDurableNotificationInboxToLegacyDatabase()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE \"UserNotifications\";");

        await DatabaseSchema.UpgradeAsync(db, default);

        var tables = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM sqlite_master WHERE type = 'table'")
            .ToArrayAsync();
        Assert.Contains("UserNotifications", tables);
        var indexes = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM sqlite_master WHERE type = 'index' AND tbl_name = 'UserNotifications'")
            .ToArrayAsync();
        Assert.Contains("IX_UserNotifications_Id", indexes);
        Assert.Contains("IX_UserNotifications_ServerId_UserId_Sequence", indexes);
        Assert.Contains("IX_UserNotifications_ServerId_UserId_ReadAt_Sequence", indexes);
        Assert.Contains("IX_UserNotifications_UserId_ReadAt_Sequence", indexes);
        var columns = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM pragma_table_info('UserNotifications')")
            .ToArrayAsync();
        Assert.Contains("TargetInviteCode", columns);
    }

    [Fact]
    public async Task UpgradeCollapsesOppositeLegacyFriendRequestsBeforeAddingPairKey()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userIds = await db.Users.OrderBy(x => x.CreatedAt).Select(x => x.Id).Take(2).ToArrayAsync();
        var firstRequestId = Guid.NewGuid();
        var secondRequestId = Guid.NewGuid();
        var createdAt = DateTime.UtcNow;
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP INDEX "IX_FriendRequests_PairKey";
            ALTER TABLE "FriendRequests" DROP COLUMN "PairKey";
            """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "FriendRequests" ("Id", "SenderId", "ReceiverId", "CreatedAt")
            VALUES ({firstRequestId}, {userIds[0]}, {userIds[1]}, {createdAt});
            """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "FriendRequests" ("Id", "SenderId", "ReceiverId", "CreatedAt")
            VALUES ({secondRequestId}, {userIds[1]}, {userIds[0]}, {createdAt.AddSeconds(1)});
            """);

        await DatabaseSchema.UpgradeAsync(db, default);
        db.ChangeTracker.Clear();

        var request = Assert.Single(await db.FriendRequests.AsNoTracking().ToArrayAsync());
        Assert.Equal(firstRequestId, request.Id);
        Assert.False(string.IsNullOrWhiteSpace(request.PairKey));
    }
}
