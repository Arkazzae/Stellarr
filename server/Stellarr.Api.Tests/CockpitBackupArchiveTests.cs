using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Backups;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class CockpitBackupArchiveTests
{
    private const string SqliteHeader = "SQLite format 3\0";

    [Fact]
    public async Task AFullBackupHoldsTheDatabaseEveryObjectTheKeysAndTheInstanceFiles()
    {
        var storage = new FakeObjectStorage();
        await PutAsync(storage, "attachments/one/photo.png", "first object");
        await PutAsync(storage, "avatars/two.webp", "second object");
        using var factory = Factory(storage);
        using var owner = await OwnerAsync(factory);
        // What the container's entrypoint keeps on the data volume, next to what a backup leaves out.
        WriteDataFile(factory, "secrets/storage-secret-key", "generated secret");
        WriteDataFile(factory, "tls/fullchain.pem", "certificate");
        WriteDataFile(factory, "releases/desktop/desktop-release.json", "{}");
        WriteDataFile(factory, "logs/stellarr.log", "a log line");

        var started = await owner.PostAsJsonAsync(
            "/api/cockpit/backups",
            new { database = true, objects = true, keys = true, instance = true });

        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        var job = await JsonAsync(started);
        var id = job.GetProperty("id").GetString()!;
        Assert.Matches(@"^backup-\d{8}-\d{6}-[0-9a-f]{32}\.zip$", id);
        Assert.Equal(["database", "objects", "keys", "instance"], job.GetProperty("parts").EnumerateArray().Select(x => x.GetString()));

        var listed = await FinishedAsync(owner, id);
        Assert.Equal(["database", "objects", "keys", "instance"], listed.GetProperty("parts").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(0, listed.GetProperty("missingObjects").GetInt32());

        var download = await owner.GetAsync($"/api/cockpit/backups/{id}/download");
        download.EnsureSuccessStatusCode();
        Assert.Equal("application/zip", download.Content.Headers.ContentType?.MediaType);
        var bytes = await download.Content.ReadAsByteArrayAsync();
        await using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        Assert.Equal(SqliteHeader, Encoding.ASCII.GetString(await ReadAsync(zip, BackupArchive.DatabaseEntry), 0, 16));
        Assert.Equal("first object", Encoding.UTF8.GetString(await ReadAsync(zip, "objects/attachments/one/photo.png")));
        Assert.Equal("second object", Encoding.UTF8.GetString(await ReadAsync(zip, "objects/avatars/two.webp")));
        Assert.Contains(zip.Entries, x => x.FullName.StartsWith("keys/", StringComparison.Ordinal));
        Assert.Equal("generated secret", Encoding.UTF8.GetString(await ReadAsync(zip, "instance/secrets/storage-secret-key")));
        Assert.Equal("certificate", Encoding.UTF8.GetString(await ReadAsync(zip, "instance/tls/fullchain.pem")));
        Assert.NotNull(zip.GetEntry("instance/releases/desktop/desktop-release.json"));
        Assert.DoesNotContain(zip.Entries, x => x.FullName.Contains("logs/", StringComparison.Ordinal));
        Assert.DoesNotContain(zip.Entries, x => x.FullName.Contains("backups/", StringComparison.Ordinal));

        using var manifest = JsonDocument.Parse(await ReadAsync(zip, BackupArchive.ManifestEntry));
        Assert.Equal("stellarr-backup", manifest.RootElement.GetProperty("format").GetString());
        Assert.Equal(2, manifest.RootElement.GetProperty("objectCount").GetInt32());
        Assert.Equal(3, manifest.RootElement.GetProperty("instanceFiles").GetInt32());
        (await owner.PostAsync($"/api/cockpit/backups/{id}/verify", null)).EnsureSuccessStatusCode();
        // The test environment sets the Resend key: its name is listed, its value is not in the archive.
        Assert.Contains(
            "STELLARR_RESEND_API_KEY",
            manifest.RootElement.GetProperty("environmentSecrets").EnumerateArray().Select(x => x.GetString()));
        Assert.DoesNotContain("re_test", Encoding.UTF8.GetString(bytes), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnArchiveVerifiesAndADamagedOneDoesNot()
    {
        var storage = new FakeObjectStorage();
        await PutAsync(storage, "attachments/one/photo.png", new string('x', 4096));
        using var factory = Factory(storage);
        using var owner = await OwnerAsync(factory);
        var id = await StartAsync(owner, new { database = true, objects = true, keys = false });
        await FinishedAsync(owner, id);

        var verified = await owner.PostAsync($"/api/cockpit/backups/{id}/verify", null);
        verified.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.String, (await JsonAsync(verified)).GetProperty("verifiedAt").ValueKind);
        // The check works on a copy and leaves nothing of it behind.
        Assert.Equal(
            [id, id + ".verified"],
            Directory.EnumerateFiles(Path.Combine(factory.DataRoot, "backups")).Select(Path.GetFileName).Order(StringComparer.Ordinal));

        var path = Path.Combine(factory.DataRoot, "backups", id);
        var damaged = await File.ReadAllBytesAsync(path);
        await File.WriteAllBytesAsync(path, damaged[..(damaged.Length / 2)]);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync($"/api/cockpit/backups/{id}/verify", null)).StatusCode);
    }

    [Fact]
    public async Task AnObjectTheStoreCannotGiveIsListedNotFatal()
    {
        var storage = new FakeObjectStorage();
        await PutAsync(storage, "attachments/kept.png", "kept");
        await PutAsync(storage, "attachments/lost.png", "lost");
        using var factory = Factory(new FailingKeyStorage(storage, "attachments/lost.png"));
        using var owner = await OwnerAsync(factory);

        var id = await StartAsync(owner, new { database = false, objects = true, keys = false });
        var listed = await FinishedAsync(owner, id);

        Assert.Equal(["objects"], listed.GetProperty("parts").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(1, listed.GetProperty("missingObjects").GetInt32());
        (await owner.PostAsync($"/api/cockpit/backups/{id}/verify", null)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task OneBackupRunsAtATime()
    {
        var storage = new FakeObjectStorage();
        await PutAsync(storage, "attachments/slow.png", "slow");
        var gate = new GatedStorage(storage);
        using var factory = Factory(gate);
        using var owner = await OwnerAsync(factory);

        var id = await StartAsync(owner, new { database = false, objects = true, keys = false });
        await gate.Reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var running = await JsonAsync(await owner.GetAsync("/api/cockpit/backups"));
        var second = await owner.PostAsJsonAsync("/api/cockpit/backups", new { database = true, objects = false, keys = true });

        Assert.Equal(id, running.GetProperty("job").GetProperty("id").GetString());
        Assert.Equal("objects", running.GetProperty("job").GetProperty("phase").GetString());
        Assert.Equal(1, running.GetProperty("job").GetProperty("objectsTotal").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        gate.Release.SetResult();
        await FinishedAsync(owner, id);
    }

    [Fact]
    public async Task AFailedBackupLeavesNoFileAndSaysWhy()
    {
        using var factory = Factory(new UnlistableStorage());
        using var owner = await OwnerAsync(factory);

        await StartAsync(owner, new { database = true, objects = true, keys = true });
        var state = await IdleAsync(owner);

        Assert.Empty(state.GetProperty("backups").EnumerateArray());
        Assert.Contains("store is down", state.GetProperty("lastFailure").GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(factory.DataRoot, "backups")));
    }

    [Fact]
    public async Task ABackupWithNothingInItIsRefused()
    {
        using var factory = Factory(new FakeObjectStorage());
        using var owner = await OwnerAsync(factory);

        var response = await owner.PostAsJsonAsync("/api/cockpit/backups", new { database = false, objects = false, keys = false });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task APartialArchiveLeftByAStopIsRemovedAtStart()
    {
        var dataRoot = Path.Combine(Path.GetTempPath(), $"stellarr-data-{Guid.NewGuid():N}");
        var backups = Directory.CreateDirectory(Path.Combine(dataRoot, "backups"));
        var leftover = Path.Combine(backups.FullName, ".backup-20260101-000000-0123456789abcdef0123456789abcdef.zip.partial");
        var sideFile = Path.Combine(backups.FullName, ".verify-0123456789abcdef0123456789abcdef.partial-wal");
        await File.WriteAllTextAsync(sideFile, "wal");
        var kept = Path.Combine(backups.FullName, "backup-20260101-000000-0123456789abcdef0123456789abcdef.db");
        await File.WriteAllTextAsync(leftover, "half");
        await File.WriteAllTextAsync(kept, "whole");

        using var factory = new StellarrWebApplicationFactory(loadTestData: true, dataRoot: dataRoot);
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        Assert.False(File.Exists(leftover));
        Assert.False(File.Exists(sideFile));
        Assert.True(File.Exists(kept));
    }

    private static StellarrWebApplicationFactory Factory(IObjectStorage storage) => new(
        loadTestData: true,
        configureServices: services =>
        {
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton(storage);
        });

    private static void WriteDataFile(StellarrWebApplicationFactory factory, string relativePath, string text)
    {
        var path = Path.Combine(factory.DataRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    private static Task PutAsync(FakeObjectStorage storage, string key, string text) =>
        storage.PutAsync(key, new MemoryStream(Encoding.UTF8.GetBytes(text)), CancellationToken.None);

    private static async Task<string> StartAsync(HttpClient owner, object parts)
    {
        var started = await owner.PostAsJsonAsync("/api/cockpit/backups", parts);
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        return (await JsonAsync(started)).GetProperty("id").GetString()!;
    }

    /// <summary>The backup list once no job runs any more.</summary>
    private static async Task<JsonElement> IdleAsync(HttpClient owner)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (true)
        {
            var state = await JsonAsync(await owner.GetAsync("/api/cockpit/backups"));
            if (state.GetProperty("job").ValueKind == JsonValueKind.Null)
            {
                return state;
            }

            Assert.True(DateTime.UtcNow < deadline, "The backup did not finish in time.");
            await Task.Delay(50);
        }
    }

    /// <summary>The finished backup <paramref name="id"/> as the list shows it.</summary>
    private static async Task<JsonElement> FinishedAsync(HttpClient owner, string id)
    {
        var state = await IdleAsync(owner);
        Assert.Equal(JsonValueKind.Null, state.GetProperty("lastFailure").ValueKind);
        return state.GetProperty("backups").EnumerateArray().Single(x => x.GetProperty("id").GetString() == id);
    }

    private static async Task<byte[]> ReadAsync(ZipArchive zip, string entryName)
    {
        var entry = zip.GetEntry(entryName) ?? throw new InvalidOperationException($"No entry {entryName}.");
        await using var stream = await entry.OpenAsync();
        using var copy = new MemoryStream();
        await stream.CopyToAsync(copy);
        return copy.ToArray();
    }

    private static async Task<HttpClient> OwnerAsync(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    /// <summary>A store that lists an object it then cannot give.</summary>
    private sealed class FailingKeyStorage(FakeObjectStorage inner, string failingKey) : IObjectStorage
    {
        public Task PrepareAsync(CancellationToken cancellationToken) => inner.PrepareAsync(cancellationToken);

        public Task PutAsync(string key, Stream data, CancellationToken cancellationToken) =>
            inner.PutAsync(key, data, cancellationToken);

        public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken) =>
            key == failingKey ? throw new IOException("Gone.") : inner.GetAsync(key, range, cancellationToken);

        public Task DeleteAsync(string key, CancellationToken cancellationToken) => inner.DeleteAsync(key, cancellationToken);

        public IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken) => inner.ListAsync(cancellationToken);

        public Task ProbeAsync(CancellationToken cancellationToken) => inner.ProbeAsync(cancellationToken);
    }

    /// <summary>A store whose reads wait until the test lets them through.</summary>
    private sealed class GatedStorage(FakeObjectStorage inner) : IObjectStorage
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task PrepareAsync(CancellationToken cancellationToken) => inner.PrepareAsync(cancellationToken);

        public Task PutAsync(string key, Stream data, CancellationToken cancellationToken) =>
            inner.PutAsync(key, data, cancellationToken);

        public async Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken)
        {
            Reached.TrySetResult();
            await Release.Task.WaitAsync(cancellationToken);
            return await inner.GetAsync(key, range, cancellationToken);
        }

        public Task DeleteAsync(string key, CancellationToken cancellationToken) => inner.DeleteAsync(key, cancellationToken);

        public IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken) => inner.ListAsync(cancellationToken);

        public Task ProbeAsync(CancellationToken cancellationToken) => inner.ProbeAsync(cancellationToken);
    }

    /// <summary>A store that is down when the backup lists it.</summary>
    private sealed class UnlistableStorage : IObjectStorage
    {
        public Task PrepareAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task PutAsync(string key, Stream data, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken) =>
            throw new IOException("The store is down.");

        public Task DeleteAsync(string key, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task ProbeAsync(CancellationToken cancellationToken) => throw new IOException("The store is down.");

        public async IAsyncEnumerable<StoredObjectInfo> ListAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
        {
            await Task.Yield();
            throw new IOException("The store is down.");
#pragma warning disable CS0162 // An iterator needs a yield to be one.
            yield break;
#pragma warning restore CS0162
        }
    }
}
