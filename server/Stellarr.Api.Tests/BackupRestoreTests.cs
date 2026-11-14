using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Stellarr.Api.Backups;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

/// <summary>
/// Restoring a full backup with the CLI: staged while the instance runs,
/// applied as the container's start does, and refused without a trace when
/// the archive cannot be restored.
/// </summary>
public sealed class BackupRestoreTests : IDisposable
{
    /// <summary>An API address nothing answers at, so `backup apply` sees a stopped instance.</summary>
    private static readonly Dictionary<string, string?> NoApi = new() { ["STELLARR_API_URL"] = "http://127.0.0.1:9" };

    private static readonly byte[] Picture = "picture-bytes"u8.ToArray();

    private readonly string _scratch = Path.Combine(Path.GetTempPath(), $"stellarr-restore-{Guid.NewGuid():N}");

    public BackupRestoreTests() => Directory.CreateDirectory(_scratch);

    [Fact]
    public async Task AFullBackupIsStagedThenPutInPlaceAndTheReplacedDataIsKept()
    {
        using var fixture = CliFixture.CreateUnstarted();
        await WriteTargetAsync(fixture.Root);
        var archive = await WriteArchiveAsync(BackupParts.All);

        var stage = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "restore", archive, "--yes");

        Assert.Equal(0, stage.ExitCode);
        Assert.True(File.Exists(BackupRestore.StagedArchivePath(fixture.Root)));
        Assert.Equal("target", Marker(fixture.Root));

        var apply = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "apply", "--yes");

        Assert.Equal(0, apply.ExitCode);
        Assert.Equal("source", Marker(fixture.Root));
        Assert.False(File.Exists(Path.Combine(fixture.Root, "db", "stellarr.db-wal")));
        Assert.Equal(Picture, await File.ReadAllBytesAsync(Path.Combine(fixture.Root, "files", "images", "2026", "11", "a.png")));
        Assert.False(Directory.Exists(Path.Combine(fixture.Root, "files", "old")));
        Assert.True(File.Exists(Path.Combine(fixture.Root, "keys", "key-source.xml")));
        Assert.False(File.Exists(Path.Combine(fixture.Root, "keys", "key-target.xml")));
        var secret = Path.Combine(fixture.Root, "secrets", "turn-shared-secret");
        Assert.Equal("source-turn", await File.ReadAllTextAsync(secret));
        if (!OperatingSystem.IsWindows())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(secret));
        }
        Assert.True(Directory.Exists(Path.Combine(fixture.Root, "releases")));

        // What a restore does not own stays where it was.
        Assert.True(File.Exists(Path.Combine(fixture.Root, "logs", "api.log")));
        Assert.True(File.Exists(Path.Combine(fixture.Root, "backups", "kept.zip")));

        Assert.False(File.Exists(BackupRestore.StagedArchivePath(fixture.Root)));
        var previous = Assert.Single(Directory.GetDirectories(Path.Combine(fixture.Root, "restore"), "previous-*"));
        Assert.Equal("target", Marker(previous));
        Assert.True(File.Exists(Path.Combine(previous, "db", "stellarr.db-wal")));
        Assert.True(File.Exists(Path.Combine(previous, "files", "old", "c.bin")));
        Assert.Equal("target-turn", await File.ReadAllTextAsync(Path.Combine(previous, "secrets", "turn-shared-secret")));
        Assert.Equal("restored", LastOutcome(fixture.Root));
        Assert.Contains("mail.smtp-password", apply.Output, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnArchiveInTheInstancesBackupsFolderIsFoundByItsName()
    {
        using var fixture = CliFixture.CreateUnstarted();
        var backups = Directory.CreateDirectory(Path.Combine(fixture.Root, "backups")).FullName;
        File.Copy(await WriteArchiveAsync(BackupParts.All), Path.Combine(backups, "backup-20261114-030000-abc.zip"));

        var verify = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "verify", "backup-20261114-030000-abc.zip");

        Assert.Equal(0, verify.ExitCode);
        using var json = JsonDocument.Parse(verify.Output);
        Assert.Equal(2, json.RootElement.GetProperty("data").GetProperty("objectCount").GetInt32());
    }

    [Fact]
    public async Task APartialBackupIsNotStaged()
    {
        using var fixture = CliFixture.CreateUnstarted();
        var archive = await WriteArchiveAsync(BackupParts.Database | BackupParts.Objects | BackupParts.Keys);

        var stage = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "restore", archive, "--yes");

        Assert.Equal(4, stage.ExitCode);
        Assert.Equal("backup_refused", ErrorCode(stage));
        Assert.Contains("instance", ErrorMessage(stage), StringComparison.Ordinal);
        Assert.False(File.Exists(BackupRestore.StagedArchivePath(fixture.Root)));
    }

    [Theory]
    [InlineData("objects/../../escape")]
    [InlineData("objects/.incoming/half-written")]
    [InlineData("keys/nested/key.xml")]
    [InlineData("instance/etc/passwd")]
    [InlineData("instance/secrets")]
    [InlineData("database/other.db")]
    [InlineData("elsewhere.txt")]
    public async Task AnEntryThatBelongsNowhereIsRefusedBeforeAnythingChanges(string entry)
    {
        using var fixture = CliFixture.CreateUnstarted();
        await WriteTargetAsync(fixture.Root);
        var archive = await WriteArchiveAsync(BackupParts.All);
        await AddEntryAsync(archive, entry);
        File.Copy(archive, Stage(fixture.Root));

        var apply = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "apply", "--yes");

        Assert.Equal(4, apply.ExitCode);
        Assert.Equal("restore_refused", ErrorCode(apply));
        Assert.Contains(entry, ErrorMessage(apply), StringComparison.Ordinal);
        AssertUntouched(fixture.Root);
        Assert.Single(Directory.GetFiles(Path.Combine(fixture.Root, "restore"), "refused-*.zip"));
        Assert.Equal("refused", LastOutcome(fixture.Root));
    }

    [Fact]
    public async Task AnArchiveThatPassesItsCheckButCannotBeUnpackedLeavesTheDataAsItWas()
    {
        using var fixture = CliFixture.CreateUnstarted();
        await WriteTargetAsync(fixture.Root);
        var archive = await WriteArchiveAsync(BackupParts.All);
        // Each name is safe, and the counts agree, but "x" cannot be a file and a folder at once.
        await AddEntryAsync(archive, "objects/x", "objects/x/y");
        File.Copy(archive, Stage(fixture.Root));

        var apply = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "apply", "--yes");

        Assert.Equal(4, apply.ExitCode);
        Assert.Contains("could not be unpacked", ErrorMessage(apply), StringComparison.Ordinal);
        AssertUntouched(fixture.Root);
        var restore = Path.Combine(fixture.Root, "restore");
        Assert.Empty(Directory.GetDirectories(restore, ".unpacking-*"));
        Assert.Empty(Directory.GetDirectories(restore, "previous-*"));
    }

    [Fact]
    public async Task ASwapThatFailsPartWayPutsEveryFolderBack()
    {
        using var fixture = CliFixture.CreateUnstarted();
        await WriteTargetAsync(fixture.Root);
        // The last folder a restore replaces cannot be replaced: a file holds its name.
        await WriteFileAsync(Path.Combine(fixture.Root, "releases"), "in the way");
        File.Copy(await WriteArchiveAsync(BackupParts.All), Stage(fixture.Root));

        var apply = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "apply", "--yes");

        Assert.Equal(4, apply.ExitCode);
        Assert.Contains("could not be put in place", ErrorMessage(apply), StringComparison.Ordinal);
        AssertUntouched(fixture.Root);
        Assert.Equal("in the way", await File.ReadAllTextAsync(Path.Combine(fixture.Root, "releases")));
        var restore = Path.Combine(fixture.Root, "restore");
        Assert.Empty(Directory.GetDirectories(restore, "previous-*"));
        Assert.Empty(Directory.GetDirectories(restore, ".unpacking-*"));
        Assert.False(File.Exists(Path.Combine(restore, BackupRestore.BrokenMarkerName)));
    }

    [Fact]
    public async Task WhatAnInterruptedRestoreLeftIsClearedByTheNextOne()
    {
        using var fixture = CliFixture.CreateUnstarted();
        await WriteTargetAsync(fixture.Root);
        File.Copy(await WriteArchiveAsync(BackupParts.All), Stage(fixture.Root));
        var restore = Path.Combine(fixture.Root, "restore");
        await WriteFileAsync(Path.Combine(restore, ".unpacking-cut-short", "db", "stellarr.db"), "half");
        await WriteFileAsync(Path.Combine(restore, ".verify-cut-short.partial"), "half");
        await WriteFileAsync(Path.Combine(restore, "staged.zip.cut-short.partial"), "half");

        var apply = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "apply", "--yes");

        Assert.Equal(0, apply.ExitCode);
        Assert.Equal("source", Marker(fixture.Root));
        Assert.Empty(Directory.GetDirectories(restore, ".unpacking-*"));
        Assert.Empty(Directory.GetFiles(restore, "*.partial"));
    }

    [Fact]
    public async Task ADatabaseOnlyBackupIsRefusedWithWhereToRestoreItByHand()
    {
        using var fixture = CliFixture.CreateUnstarted();
        var database = await CreateDatabaseAsync(Path.Combine(_scratch, "database-only"), "source");

        var verify = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "verify", database);

        Assert.Equal(4, verify.ExitCode);
        Assert.Contains("database-only", ErrorMessage(verify), StringComparison.Ordinal);
        Assert.Contains("docs/admin/backups.md", ErrorMessage(verify), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnArchiveFromANewerBackupFormatIsRefused()
    {
        using var fixture = CliFixture.CreateUnstarted();
        var archive = await WriteArchiveAsync(BackupParts.All);
        await RewriteManifestAsync(archive, manifest => manifest with { Version = BackupManifest.CurrentVersion + 1 });

        var verify = await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "verify", archive);

        Assert.Equal(4, verify.ExitCode);
        Assert.Contains("format", ErrorMessage(verify), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ApplyingRefusesWhileTheApiAnswersAndKeepsTheStagedArchive()
    {
        using var fixture = CliFixture.CreateUnstarted();
        await WriteTargetAsync(fixture.Root);
        File.Copy(await WriteArchiveAsync(BackupParts.All), Stage(fixture.Root));
        using var api = new HttpListener();
        var port = FreePort();
        api.Prefixes.Add($"http://127.0.0.1:{port}/");
        api.Start();
        var answering = Task.Run(async () =>
        {
            var context = await api.GetContextAsync();
            context.Response.StatusCode = 200;
            context.Response.Close();
        });

        var apply = await fixture.RunWithEnvironmentAsync(
            new Dictionary<string, string?> { ["STELLARR_API_URL"] = $"http://127.0.0.1:{port}" },
            "--json", "backup", "apply", "--yes");
        await answering;

        Assert.Equal(4, apply.ExitCode);
        Assert.Equal("instance_running", ErrorCode(apply));
        AssertUntouched(fixture.Root);
        Assert.True(File.Exists(BackupRestore.StagedArchivePath(fixture.Root)));
    }

    [Fact]
    public async Task CancellingDropsTheStagedArchive()
    {
        using var fixture = CliFixture.CreateUnstarted();
        File.Copy(await WriteArchiveAsync(BackupParts.All), Stage(fixture.Root));

        Assert.Equal(0, (await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "cancel", "--yes")).ExitCode);
        Assert.False(File.Exists(BackupRestore.StagedArchivePath(fixture.Root)));
        Assert.Equal(3, (await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "cancel", "--yes")).ExitCode);
        Assert.Equal(3, (await fixture.RunWithEnvironmentAsync(NoApi, "--json", "backup", "apply", "--yes")).ExitCode);
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_scratch))
        {
            Directory.Delete(_scratch, recursive: true);
        }
    }

    /// <summary>
    /// A backup of a small instance: a database, two uploads, a key, a
    /// secret and a TLS key, but no desktop releases.
    /// </summary>
    private async Task<string> WriteArchiveAsync(BackupParts parts)
    {
        var source = Path.Combine(_scratch, $"source-{Guid.NewGuid():N}");
        var database = await CreateDatabaseAsync(Path.Combine(source, "db"), "source");
        var storage = new FileSystemObjectStorage(Path.Combine(source, FileSystemObjectStorage.FolderName));
        await PutAsync(storage, "images/2026/11/a.png", Picture);
        await PutAsync(storage, "audio/2026/11/b.webm", "voice"u8.ToArray());
        await WriteFileAsync(Path.Combine(source, "keys", "key-source.xml"), "<key />");
        await WriteFileAsync(Path.Combine(source, "secrets", "turn-shared-secret"), "source-turn");
        await WriteFileAsync(Path.Combine(source, "tls", "privkey.pem"), "source-key");

        var objects = new List<StoredObjectInfo>();
        await foreach (var item in storage.ListAsync(CancellationToken.None))
        {
            objects.Add(item);
        }

        var archive = Path.Combine(_scratch, $"backup-{Guid.NewGuid():N}.zip");
        await BackupArchive.WriteAsync(
            archive,
            parts,
            new BackupSources(
                $"Data Source={database};Pooling=False",
                storage,
                objects,
                Path.Combine(source, "keys"),
                "Source",
                ["mail.smtp-password"],
                _scratch,
                source),
            new BackupProgress(),
            CancellationToken.None);
        return archive;
    }

    /// <summary>The instance a restore replaces, with the things a restore must leave alone.</summary>
    private static async Task WriteTargetAsync(string root)
    {
        await CreateDatabaseAsync(Path.Combine(root, "db"), "target");
        await WriteFileAsync(Path.Combine(root, "db", "stellarr.db-wal"), "");
        await WriteFileAsync(Path.Combine(root, "files", "old", "c.bin"), "old");
        await WriteFileAsync(Path.Combine(root, "keys", "key-target.xml"), "<key />");
        await WriteFileAsync(Path.Combine(root, "secrets", "turn-shared-secret"), "target-turn");
        await WriteFileAsync(Path.Combine(root, "logs", "api.log"), "log");
        await WriteFileAsync(Path.Combine(root, "backups", "kept.zip"), "zip");
    }

    private static void AssertUntouched(string root)
    {
        Assert.Equal("target", Marker(root));
        Assert.True(File.Exists(Path.Combine(root, "db", "stellarr.db-wal")));
        Assert.True(File.Exists(Path.Combine(root, "files", "old", "c.bin")));
        Assert.True(File.Exists(Path.Combine(root, "keys", "key-target.xml")));
        Assert.Equal("target-turn", File.ReadAllText(Path.Combine(root, "secrets", "turn-shared-secret")));
        Assert.False(File.Exists(Path.Combine(root, "files", "images", "2026", "11", "a.png")));
    }

    private static async Task<string> CreateDatabaseAsync(string folder, string marker)
    {
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "stellarr.db");
        await using var connection = new SqliteConnection($"Data Source={path};Pooling=False");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ($value);";
        command.Parameters.AddWithValue("$value", marker);
        await command.ExecuteNonQueryAsync();
        return path;
    }

    /// <summary>Which instance's database sits under a data root.</summary>
    private static string Marker(string root)
    {
        // A copy, so the -wal file kept beside the replaced database is not read as its log.
        var copy = Path.Combine(Path.GetTempPath(), $"stellarr-marker-{Guid.NewGuid():N}.db");
        File.Copy(Path.Combine(root, "db", "stellarr.db"), copy);
        try
        {
            using var connection = new SqliteConnection($"Data Source={copy};Mode=ReadOnly;Pooling=False");
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT value FROM marker";
            return (string)command.ExecuteScalar()!;
        }
        finally
        {
            File.Delete(copy);
        }
    }

    private static async Task PutAsync(FileSystemObjectStorage storage, string key, byte[] bytes)
    {
        using var data = new MemoryStream(bytes);
        await storage.PutAsync(key, data, CancellationToken.None);
    }

    private static async Task WriteFileAsync(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, text);
    }

    /// <summary>Adds objects (or other entries) and counts the objects in the manifest, as a backup would.</summary>
    private static async Task AddEntryAsync(string archive, params string[] entries)
    {
        await using (var zip = await ZipFile.OpenAsync(archive, ZipArchiveMode.Update))
        {
            foreach (var name in entries)
            {
                await using var stream = await zip.CreateEntry(name).OpenAsync();
                await stream.WriteAsync("added"u8.ToArray());
            }
        }

        var objects = entries.Count(x => x.StartsWith(BackupArchive.ObjectsFolder, StringComparison.Ordinal));
        await RewriteManifestAsync(archive, manifest => manifest with { ObjectCount = manifest.ObjectCount + objects });
    }

    private static async Task RewriteManifestAsync(string archive, Func<BackupManifest, BackupManifest> change)
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        await using var zip = await ZipFile.OpenAsync(archive, ZipArchiveMode.Update);
        var entry = zip.GetEntry(BackupArchive.ManifestEntry)!;
        BackupManifest manifest;
        await using (var stream = await entry.OpenAsync())
        {
            manifest = (await JsonSerializer.DeserializeAsync<BackupManifest>(stream, options))!;
        }

        entry.Delete();
        await using var rewritten = await zip.CreateEntry(BackupArchive.ManifestEntry).OpenAsync();
        await rewritten.WriteAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(change(manifest), options)));
    }

    private static string Stage(string root)
    {
        var staged = BackupRestore.StagedArchivePath(root);
        Directory.CreateDirectory(Path.GetDirectoryName(staged)!);
        return staged;
    }

    private static string LastOutcome(string root)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "restore", BackupRestore.LastResultName)));
        return json.RootElement.GetProperty("outcome").GetString()!;
    }

    private static string ErrorCode(CliRun run)
    {
        using var json = JsonDocument.Parse(run.Output);
        return json.RootElement.GetProperty("error").GetProperty("code").GetString()!;
    }

    private static string ErrorMessage(CliRun run)
    {
        using var json = JsonDocument.Parse(run.Output);
        return json.RootElement.GetProperty("error").GetProperty("message").GetString()!;
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}
