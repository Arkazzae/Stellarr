using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Endpoints;

namespace Stellarr.Api.Tests;

public sealed class OpsBackupTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string SqliteHeader = "SQLite format 3\0";

    private readonly StellarrWebApplicationFactory _factory;

    public OpsBackupTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Theory]
    [InlineData("GET", "/api/ops/backups")]
    [InlineData("POST", "/api/ops/backups")]
    [InlineData("POST", "/api/ops/backups/backup-any.db/verify")]
    [InlineData("GET", "/api/ops/backups/backup-any.db/download")]
    public async Task OnlyTheInstanceOwnerTouchesBackups(string method, string path)
    {
        using var anonymous = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(anonymous, method, path)).StatusCode);

        using var member = Client();
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(member, method, path)).StatusCode);
    }

    [Fact]
    public async Task OwnerCreatesListsVerifiesAndDownloadsABackup()
    {
        using var owner = await OwnerAsync();

        var created = await owner.PostAsync("/api/ops/backups", null);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var backup = await JsonAsync(created);
        var id = backup.GetProperty("id").GetString()!;
        Assert.Matches(@"^backup-\d{8}-\d{6}-[0-9a-f]{32}\.db$", id);
        Assert.Equal($"/api/ops/backups/{id}", created.Headers.Location?.OriginalString);
        Assert.True(backup.GetProperty("sizeBytes").GetInt64() > 0);
        Assert.Equal(JsonValueKind.Null, backup.GetProperty("verifiedAt").ValueKind);
        Assert.True(File.Exists(Path.Combine(_factory.DataRoot, "backups", id)));

        var listed = await ListedAsync(owner, id);
        Assert.Equal(JsonValueKind.Null, listed.GetProperty("verifiedAt").ValueKind);
        Assert.Equal(14, (await JsonAsync(await owner.GetAsync("/api/ops/backups"))).GetProperty("retentionDays").GetInt32());

        var verified = await owner.PostAsync($"/api/ops/backups/{id}/verify", null);
        verified.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.String, (await JsonAsync(verified)).GetProperty("verifiedAt").ValueKind);
        Assert.Equal(JsonValueKind.String, (await ListedAsync(owner, id)).GetProperty("verifiedAt").ValueKind);

        var download = await owner.GetAsync($"/api/ops/backups/{id}/download");
        download.EnsureSuccessStatusCode();
        Assert.Equal("application/vnd.sqlite3", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal(id, download.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var bytes = await download.Content.ReadAsByteArrayAsync();
        Assert.Equal(await File.ReadAllBytesAsync(Path.Combine(_factory.DataRoot, "backups", id)), bytes);
        Assert.Equal(5, await CountUsersAsync(bytes));

        await using var scope = _factory.Services.CreateAsyncScope();
        var audit = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .ServerAuditEntries.AsNoTracking().Select(x => x.Summary).ToArrayAsync();
        Assert.Contains($"Maja utworzył(a) backup {id}", audit);
        Assert.Contains($"Maja zweryfikował(a) backup {id}", audit);
    }

    [Fact]
    public async Task DownloadHonoursRangeRequests()
    {
        using var owner = await OwnerAsync();
        var id = (await JsonAsync(await owner.PostAsync("/api/ops/backups", null))).GetProperty("id").GetString();
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/ops/backups/{id}/download");
        request.Headers.Range = new RangeHeaderValue(0, SqliteHeader.Length - 1);

        var response = await owner.SendAsync(request);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal(SqliteHeader, await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("backup-missing.db")]
    [InlineData("not-a-backup.db")]
    [InlineData("backup-notadatabase.txt")]
    [InlineData("backup-..%2Foutside.db")]
    public async Task UnknownOrMalformedIdsAreNotFound(string id)
    {
        using var owner = await OwnerAsync();
        var directory = Directory.CreateDirectory(Path.Combine(_factory.DataRoot, "backups"));
        await File.WriteAllTextAsync(Path.Combine(directory.FullName, "not-a-backup.db"), "not a backup");
        await File.WriteAllTextAsync(Path.Combine(directory.FullName, "backup-notadatabase.txt"), "not a backup");

        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/ops/backups/{id}/download")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsync($"/api/ops/backups/{id}/verify", null)).StatusCode);
    }

    [Fact]
    public async Task VerifyRefusesAFileThatIsNotADatabase()
    {
        using var owner = await OwnerAsync();
        var id = $"backup-corrupt-{Guid.NewGuid():N}.db";
        var path = Path.Combine(Directory.CreateDirectory(Path.Combine(_factory.DataRoot, "backups")).FullName, id);
        await File.WriteAllTextAsync(path, new string('x', 4096));

        var response = await owner.PostAsync($"/api/ops/backups/{id}/verify", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.False(File.Exists(path + ".verified"));
        Assert.Equal(JsonValueKind.Null, (await ListedAsync(owner, id)).GetProperty("verifiedAt").ValueKind);
    }

    [Fact]
    public async Task FailedCopyLeavesNoFileBehind()
    {
        var directory = Directory.CreateDirectory(Path.Combine(_factory.DataRoot, $"copy-{Guid.NewGuid():N}"));
        var notADatabase = Path.Combine(directory.FullName, "source.db");
        await File.WriteAllTextAsync(notADatabase, new string('x', 4096));
        var destination = Path.Combine(directory.FullName, "backup-copy.db");

        await Assert.ThrowsAsync<SqliteException>(() => OpsEndpoints.CopyDatabaseAsync(
            $"Data Source={notADatabase};Pooling=False",
            destination,
            CancellationToken.None));

        Assert.False(File.Exists(destination));
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, string method, string path) =>
        client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

    private static async Task<JsonElement> ListedAsync(HttpClient owner, string id)
    {
        var list = await JsonAsync(await owner.GetAsync("/api/ops/backups"));
        return list.GetProperty("backups").EnumerateArray()
            .Single(backup => backup.GetProperty("id").GetString() == id);
    }

    /// <summary>Opens the bytes as a database of their own, apart from the one the server runs on.</summary>
    private async Task<long> CountUsersAsync(byte[] database)
    {
        var path = Path.Combine(_factory.DataRoot, $"opened-{Guid.NewGuid():N}.db");
        await File.WriteAllBytesAsync(path, database);
        await using var connection = new SqliteConnection(
            new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """SELECT COUNT(*) FROM "Users";""";
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<HttpClient> OwnerAsync()
    {
        var client = Client();
        await LoginAsync(client, "maja", "Aurora!2026");
        return client;
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
