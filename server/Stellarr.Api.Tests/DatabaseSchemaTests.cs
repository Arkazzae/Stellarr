using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

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
    public async Task UpgradeAddsAccountSecurityTablesAndSessionAssurance()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP TABLE "PasskeySignIns";
            DROP TABLE "WebAuthnCredentials";
            DROP TABLE "SecurityNotifications";
            DROP TABLE "SecurityEvents";
            DROP TABLE "CliRecoveryCredentials";
            DROP TABLE "EmailOtpCodes";
            DROP TABLE "AuthChallenges";
            DROP TABLE "TrustedDevices";
            DROP TABLE "RecoveryCodes";
            DROP TABLE "MfaMethods";
            ALTER TABLE "UserSessions" DROP COLUMN "AbsoluteExpiresAt";
            ALTER TABLE "UserSessions" DROP COLUMN "PrimarySource";
            ALTER TABLE "UserSessions" DROP COLUMN "AuthenticatedAt";
            ALTER TABLE "UserSessions" DROP COLUMN "MfaCompletedAt";
            ALTER TABLE "UserSessions" DROP COLUMN "MfaEvidence";
            ALTER TABLE "UserSessions" DROP COLUMN "SecurityVersion";
            """);

        await DatabaseSchema.UpgradeAsync(db, default);
        await DatabaseSchema.UpgradeAsync(db, default);

        var tables = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM sqlite_master WHERE type = 'table'")
            .ToArrayAsync();
        foreach (var table in new[]
                 {
                     "MfaMethods", "RecoveryCodes", "TrustedDevices", "AuthChallenges",
                     "EmailOtpCodes", "CliRecoveryCredentials", "SecurityEvents", "SecurityNotifications",
                     "WebAuthnCredentials", "PasskeySignIns",
                 })
        {
            Assert.Contains(table, tables);
        }

        var columns = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM pragma_table_info('UserSessions')")
            .ToArrayAsync();
        foreach (var column in new[]
                 {
                     "AbsoluteExpiresAt", "PrimarySource", "AuthenticatedAt",
                     "MfaCompletedAt", "MfaEvidence", "SecurityVersion",
                 })
        {
            Assert.Contains(column, columns);
        }
    }

    [Fact]
    public async Task UpgradeBackfillsSessionSecurityVersionOnlyWhenAddingTheColumn()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.OrderBy(x => x.CreatedAt).FirstAsync();
        var now = DateTime.UtcNow;
        user.SessionVersion = 7;
        var sessionId = Guid.NewGuid();
        db.UserSessions.Add(new UserSession
        {
            Id = sessionId,
            UserId = user.Id,
            Device = "legacy",
            IpAddress = "192.0.2.1",
            CreatedAt = now.AddDays(-40),
            LastSeenAt = now,
            ExpiresAt = now.AddDays(5),
            AbsoluteExpiresAt = now.AddDays(5),
            PrimarySource = "password",
            SecurityVersion = 0,
        });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("""ALTER TABLE "UserSessions" DROP COLUMN "SecurityVersion";""");

        await DatabaseSchema.UpgradeAsync(db, default);
        db.ChangeTracker.Clear();
        Assert.Equal(7, (await db.UserSessions.SingleAsync(x => x.Id == sessionId)).SecurityVersion);

        await db.UserSessions.Where(x => x.Id == sessionId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.SecurityVersion, 9));
        user = await db.Users.SingleAsync(x => x.Id == user.Id);
        user.SessionVersion = 10;
        await db.SaveChangesAsync();
        await DatabaseSchema.UpgradeAsync(db, default);
        db.ChangeTracker.Clear();
        Assert.Equal(9, (await db.UserSessions.SingleAsync(x => x.Id == sessionId)).SecurityVersion);
    }

    [Fact]
    public async Task SessionsFromBeforeKeepSignedInStayKept()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.OrderBy(x => x.CreatedAt).FirstAsync();
        var now = DateTime.UtcNow;
        var sessionId = Guid.NewGuid();
        db.UserSessions.Add(new UserSession
        {
            Id = sessionId,
            UserId = user.Id,
            Device = "legacy",
            IpAddress = "192.0.2.1",
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = now.AddDays(30),
            AbsoluteExpiresAt = now.AddDays(30),
        });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "UserSessions" DROP COLUMN "ShortLived";
            ALTER TABLE "AuthChallenges" DROP COLUMN "ShortLived";
            """);

        await DatabaseSchema.UpgradeAsync(db, default);
        await DatabaseSchema.UpgradeAsync(db, default);
        db.ChangeTracker.Clear();

        Assert.False((await db.UserSessions.SingleAsync(x => x.Id == sessionId)).ShortLived);
        var columns = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM pragma_table_info('AuthChallenges')")
            .ToArrayAsync();
        Assert.Contains("ShortLived", columns);
        Assert.Contains("WebAuthnOptions", columns);
    }

    [Fact]
    public async Task IdentityLinksFromBeforeProvidersKeepTheirRows()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.OrderBy(x => x.CreatedAt).FirstAsync();
        var identityId = Guid.NewGuid();
        db.ExternalIdentities.Add(new ExternalIdentity
        {
            Id = identityId,
            UserId = user.Id,
            Issuer = "https://id.example.test",
            Subject = "older-link",
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("""ALTER TABLE "ExternalIdentities" DROP COLUMN "ProviderId";""");

        await DatabaseSchema.UpgradeAsync(db, default);
        await DatabaseSchema.UpgradeAsync(db, default);
        db.ChangeTracker.Clear();

        var identity = await db.ExternalIdentities.SingleAsync(x => x.Id == identityId);
        Assert.Equal("older-link", identity.Subject);
        Assert.Null(identity.ProviderId);
    }

    [Fact]
    public async Task UpgradeAddsOperatorAuditForTheLocalCli()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE \"OperatorAuditEntries\";");

        await DatabaseSchema.UpgradeAsync(db, default);

        var tables = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM sqlite_master WHERE type = 'table'")
            .ToArrayAsync();
        Assert.Contains("OperatorAuditEntries", tables);
        var columns = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM pragma_table_info('OperatorAuditEntries')")
            .ToArrayAsync();
        Assert.Contains("Actor", columns);
        Assert.Contains("Operation", columns);
        Assert.Contains("Target", columns);
        Assert.Contains("CreatedAt", columns);
        var indexes = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM sqlite_master WHERE type = 'index' AND tbl_name = 'OperatorAuditEntries'")
            .ToArrayAsync();
        Assert.Contains("IX_OperatorAuditEntries_CreatedAt", indexes);
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
