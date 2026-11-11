using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class HealthEndpointTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    [Theory]
    [InlineData("/health/live", "live")]
    [InlineData("/health/ready", "ready")]
    public async Task ReportsItsStatus(string path, string expectedStatus)
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expectedStatus, body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task StartsWithTheSeededFixtureData()
    {
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        Assert.Equal(5, await db.Users.CountAsync());
        Assert.Equal(1, await db.Servers.CountAsync());
        Assert.Equal(3, await db.ServerRoles.CountAsync());
        Assert.Equal(5, await db.Channels.CountAsync());
        Assert.Equal(1, await db.Messages.CountAsync());
    }

    [Fact]
    public async Task WritesToADatabaseThatOlderBuildsExtended()
    {
        // Installations created by earlier builds carry columns this model does
        // not map. Inserts that leave them out must keep working, which holds
        // because the NOT NULL one has a default and the others are nullable.
        using var isolated = new StellarrWebApplicationFactory();
        using var client = isolated.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = isolated.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Users" ADD COLUMN "IsBot" INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE "Messages" ADD COLUMN "SdkInvocationId" TEXT NULL;
            ALTER TABLE "Messages" ADD COLUMN "SdkInstallationId" TEXT NULL;
            ALTER TABLE "Messages" ADD COLUMN "SdkModuleId" TEXT NULL;
            """);

        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = "legacy",
            NormalizedUsername = "LEGACY",
            DisplayName = "Legacy",
            PasswordHash = "hash",
            AvatarColor = "#777777",
            CreatedAt = DateTime.UtcNow,
            Preferences = new UserPreferenceSettings(),
        };
        db.Users.Add(user);
        db.Messages.Add(new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = TestData.GeneralChannelId,
            AuthorId = user.Id,
            Content = "written next to extra columns",
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        Assert.Equal(2, await db.Messages.CountAsync());
        Assert.True(await db.UserPreferences.AnyAsync(x => x.UserId == user.Id));
        var messageColumns = await db.Database
            .SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('Messages')")
            .ToArrayAsync();
        Assert.Contains("SdkModuleId", messageColumns);
        var botFlags = await db.Database
            .SqlQueryRaw<long>("SELECT \"IsBot\" AS Value FROM \"Users\" WHERE \"Username\" = 'legacy'")
            .ToArrayAsync();
        Assert.Equal([0L], botFlags);
    }

    [Fact]
    public async Task WaitsForTheObjectStoreBeforeServing()
    {
        var storage = new StartingUpObjectStorage(failures: 2);
        using var starting = new StellarrWebApplicationFactory(
            loadTestData: false,
            configuration: new Dictionary<string, string?> { ["Storage:SkipInitialization"] = "false" },
            configureServices: services =>
            {
                services.RemoveAll<IObjectStorage>();
                services.AddSingleton<IObjectStorage>(storage);
            });
        using var client = starting.CreateClient();

        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(3, storage.BucketChecks);
    }

    /// <summary>An object store whose bucket check fails until it has finished starting.</summary>
    private sealed class StartingUpObjectStorage(int failures) : IObjectStorage
    {
        public int BucketChecks { get; private set; }

        public Task EnsureBucketAsync(CancellationToken cancellationToken)
        {
            BucketChecks++;
            return BucketChecks <= failures
                ? Task.FromException(new HttpRequestException("connection refused"))
                : Task.CompletedTask;
        }

        public Task PutAsync(string key, Stream data, string contentType, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
