using System.IO.Compression;
using System.Text.Json;
using Stellarr.Api.Endpoints;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Backups;

/// <summary>What a backup holds.</summary>
[Flags]
public enum BackupParts
{
    None = 0,

    /// <summary>A snapshot of the SQLite database.</summary>
    Database = 1,

    /// <summary>Every object in the object store: uploads, avatars, emoji, sounds.</summary>
    Objects = 2,

    /// <summary>The data-protection keys, without which the secrets set in Cockpit and the sessions cannot be read.</summary>
    Keys = 4,

    /// <summary>
    /// The instance's own files on the data volume: the secrets the container
    /// generated (storage, TURN), the TLS certificates and the desktop releases.
    /// </summary>
    Instance = 8,

    All = Database | Objects | Keys | Instance,
}

public static class BackupPartNames
{
    public const string Database = "database";
    public const string Objects = "objects";
    public const string Keys = "keys";
    public const string Instance = "instance";

    public static IReadOnlyList<string> Of(BackupParts parts) =>
    [
        .. parts.HasFlag(BackupParts.Database) ? [Database] : Array.Empty<string>(),
        .. parts.HasFlag(BackupParts.Objects) ? [Objects] : Array.Empty<string>(),
        .. parts.HasFlag(BackupParts.Keys) ? [Keys] : Array.Empty<string>(),
        .. parts.HasFlag(BackupParts.Instance) ? [Instance] : Array.Empty<string>(),
    ];
}

/// <summary>
/// The contents list at the root of every archive. <c>EnvironmentSecrets</c>
/// names those of the secrets Cockpit can hold that this instance reads from
/// its environment instead: their values stay on the host, in <c>.env</c>, with
/// the rest of the environment, and are not in the archive.
/// </summary>
public sealed record BackupManifest(
    string Format,
    int Version,
    DateTime CreatedAt,
    string InstanceName,
    IReadOnlyList<string> Parts,
    long DatabaseBytes,
    int ObjectCount,
    long ObjectBytes,
    IReadOnlyList<string> MissingObjects,
    int KeyFiles,
    IReadOnlyList<string> EnvironmentSecrets,
    int InstanceFiles = 0)
{
    public const string FormatName = "stellarr-backup";
    public const int CurrentVersion = 1;
}

/// <summary>Where a backup reads from.</summary>
public sealed record BackupSources(
    string DatabaseConnectionString,
    IObjectStorage Storage,
    IReadOnlyList<StoredObjectInfo> Objects,
    string KeysDirectory,
    string InstanceName,
    IReadOnlyList<string> EnvironmentSecrets,
    string WorkDirectory,
    string DataRoot);

/// <summary>How far a running backup has got; read by Cockpit while it runs.</summary>
public sealed class BackupProgress
{
    private int _objectsDone;

    public string Phase { get; set; } = BackupPartNames.Database;

    public int ObjectsTotal { get; init; }

    public int ObjectsDone => Volatile.Read(ref _objectsDone);

    internal void ObjectDone() => Interlocked.Increment(ref _objectsDone);
}

/// <summary>A failure the operator should read as it is.</summary>
public sealed class BackupFailedException(string message) : Exception(message);

/// <summary>
/// A backup as one zip file: <c>manifest.json</c>, <c>database/stellarr.db</c>,
/// <c>objects/…</c> under their own keys, <c>keys/…</c> and <c>instance/…</c>
/// as the folders sit on the data volume. Objects are stored without
/// compression, as they mostly are compressed media already.
/// </summary>
public static class BackupArchive
{
    public const string ManifestEntry = "manifest.json";
    public const string DatabaseEntry = "database/stellarr.db";
    public const string ObjectsFolder = "objects/";
    public const string KeysFolder = "keys/";
    public const string InstanceFolder = "instance/";

    /// <summary>
    /// The folders of the data volume that make up the instance files. The
    /// database, the keys, the object store's own data, the logs and the
    /// backups are elsewhere in the archive or not wanted in it.
    /// </summary>
    public static readonly IReadOnlyList<string> InstanceFolders = ["secrets", "tls", "releases"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>
    /// Writes the archive to <paramref name="archivePath"/>, the database
    /// first, so the objects it names are taken after it. An object that cannot
    /// be read is listed in the manifest instead of failing the backup; when
    /// none can be read, the store itself is the problem and the backup fails.
    /// </summary>
    public static async Task<BackupManifest> WriteAsync(
        string archivePath,
        BackupParts parts,
        BackupSources sources,
        BackupProgress progress,
        CancellationToken cancellationToken)
    {
        var databaseBytes = 0L;
        var objectCount = 0;
        var objectBytes = 0L;
        var missing = new List<string>();
        var keyFiles = 0;
        var instanceFiles = 0;

        await using (var file = new FileStream(archivePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
        await using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            if (parts.HasFlag(BackupParts.Database))
            {
                progress.Phase = BackupPartNames.Database;
                var snapshot = Path.Combine(sources.WorkDirectory, $".snapshot-{Guid.NewGuid():N}.partial");
                try
                {
                    await CockpitEndpoints.CopyDatabaseAsync(sources.DatabaseConnectionString, snapshot, cancellationToken);
                    databaseBytes = new FileInfo(snapshot).Length;
                    await AddFileAsync(zip, snapshot, DatabaseEntry, CompressionLevel.Optimal, cancellationToken);
                }
                finally
                {
                    File.Delete(snapshot);
                }
            }

            if (parts.HasFlag(BackupParts.Objects))
            {
                progress.Phase = BackupPartNames.Objects;
                foreach (var item in sources.Objects)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (!IsSafeKey(item.Key) || await TryOpenAsync(sources.Storage, item.Key, cancellationToken) is not { } stored)
                    {
                        missing.Add(item.Key);
                        progress.ObjectDone();
                        continue;
                    }

                    await using (stored.Stream)
                    {
                        var entry = zip.CreateEntry(ObjectsFolder + item.Key, CompressionLevel.NoCompression);
                        await using var target = await entry.OpenAsync(cancellationToken);
                        await stored.Stream.CopyToAsync(target, cancellationToken);
                        objectBytes += stored.TotalLength;
                    }

                    objectCount++;
                    progress.ObjectDone();
                }

                if (sources.Objects.Count > 0 && objectCount == 0)
                {
                    throw new BackupFailedException("No object could be read from the object store.");
                }
            }

            if (parts.HasFlag(BackupParts.Keys))
            {
                progress.Phase = BackupPartNames.Keys;
                if (Directory.Exists(sources.KeysDirectory))
                {
                    foreach (var key in Directory.EnumerateFiles(sources.KeysDirectory).Order(StringComparer.Ordinal))
                    {
                        await AddFileAsync(zip, key, KeysFolder + Path.GetFileName(key), CompressionLevel.Optimal, cancellationToken);
                        keyFiles++;
                    }
                }
            }

            if (parts.HasFlag(BackupParts.Instance))
            {
                progress.Phase = BackupPartNames.Instance;
                foreach (var (path, entryName) in InstanceFiles(sources.DataRoot))
                {
                    await AddFileAsync(zip, path, entryName, CompressionLevel.Optimal, cancellationToken);
                    instanceFiles++;
                }
            }

            var manifest = new BackupManifest(
                BackupManifest.FormatName,
                BackupManifest.CurrentVersion,
                DateTime.UtcNow,
                sources.InstanceName,
                BackupPartNames.Of(parts),
                databaseBytes,
                objectCount,
                objectBytes,
                missing,
                keyFiles,
                sources.EnvironmentSecrets,
                instanceFiles);
            var manifestEntry = zip.CreateEntry(ManifestEntry, CompressionLevel.Optimal);
            await using (var target = await manifestEntry.OpenAsync(cancellationToken))
            {
                await JsonSerializer.SerializeAsync(target, manifest, Json, cancellationToken);
            }

            return manifest;
        }
    }

    /// <summary>The manifest of an archive, or null when the file is not one.</summary>
    public static async Task<BackupManifest?> ReadManifestAsync(string archivePath, CancellationToken cancellationToken)
    {
        try
        {
            await using var zip = await ZipFile.OpenReadAsync(archivePath, cancellationToken);
            return await ReadManifestAsync(zip, cancellationToken);
        }
        catch (Exception exception) when (exception is InvalidDataException or JsonException or IOException)
        {
            return null;
        }
    }

    /// <returns>"ok", or what is wrong with the archive.</returns>
    public static async Task<string> VerifyAsync(string archivePath, string workDirectory, CancellationToken cancellationToken)
    {
        try
        {
            await using var zip = await ZipFile.OpenReadAsync(archivePath, cancellationToken);
            if (await ReadManifestAsync(zip, cancellationToken) is not { } manifest)
            {
                return "The archive has no readable manifest.";
            }

            if (manifest.Parts.Contains(BackupPartNames.Database))
            {
                if (zip.GetEntry(DatabaseEntry) is not { } database)
                {
                    return "The database is missing from the archive.";
                }

                var copy = Path.Combine(workDirectory, $".verify-{Guid.NewGuid():N}.partial");
                try
                {
                    await using (var source = await database.OpenAsync(cancellationToken))
                    await using (var target = File.Create(copy))
                    {
                        await source.CopyToAsync(target, cancellationToken);
                    }

                    var verdict = await CockpitEndpoints.CheckIntegrityAsync(copy, cancellationToken);
                    if (!string.Equals(verdict, "ok", StringComparison.OrdinalIgnoreCase))
                    {
                        return verdict ?? "The database failed the integrity check.";
                    }
                }
                finally
                {
                    // SQLite opens the WAL copy read-only and leaves its side files behind.
                    File.Delete(copy);
                    File.Delete(copy + "-wal");
                    File.Delete(copy + "-shm");
                }
            }

            var objects = zip.Entries.Count(x => x.FullName.StartsWith(ObjectsFolder, StringComparison.Ordinal));
            if (objects != manifest.ObjectCount)
            {
                return $"The archive holds {objects} objects; its manifest names {manifest.ObjectCount}.";
            }

            var keys = zip.Entries.Count(x => x.FullName.StartsWith(KeysFolder, StringComparison.Ordinal));
            if (keys != manifest.KeyFiles)
            {
                return $"The archive holds {keys} key files; its manifest names {manifest.KeyFiles}.";
            }

            var instance = zip.Entries.Count(x => x.FullName.StartsWith(InstanceFolder, StringComparison.Ordinal));
            if (instance != manifest.InstanceFiles)
            {
                return $"The archive holds {instance} instance files; its manifest names {manifest.InstanceFiles}.";
            }

            // Reading every entry to its end checks that none is cut short or damaged.
            foreach (var entry in zip.Entries)
            {
                await using var stream = await entry.OpenAsync(cancellationToken);
                await stream.CopyToAsync(Stream.Null, cancellationToken);
            }

            return "ok";
        }
        catch (Exception exception) when (exception is InvalidDataException or IOException)
        {
            return exception.Message;
        }
    }

    private static async Task<BackupManifest?> ReadManifestAsync(ZipArchive zip, CancellationToken cancellationToken)
    {
        if (zip.GetEntry(ManifestEntry) is not { } entry)
        {
            return null;
        }

        await using var stream = await entry.OpenAsync(cancellationToken);
        var manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(stream, Json, cancellationToken);
        return manifest?.Format == BackupManifest.FormatName ? manifest : null;
    }

    private static async Task AddFileAsync(
        ZipArchive zip,
        string path,
        string entryName,
        CompressionLevel level,
        CancellationToken cancellationToken)
    {
        var entry = zip.CreateEntry(entryName, level);
        await using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 81920, useAsync: true);
        await using var target = await entry.OpenAsync(cancellationToken);
        await source.CopyToAsync(target, cancellationToken);
    }

    /// <summary>The object, or null when the store cannot give it (gone since the listing, or unreadable).</summary>
    private static async Task<StoredObject?> TryOpenAsync(IObjectStorage storage, string key, CancellationToken cancellationToken)
    {
        try
        {
            return await storage.GetAsync(key, null, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return null;
        }
    }

    /// <summary>Every file of the instance folders, with the entry it goes to, in a stable order.</summary>
    public static IEnumerable<(string Path, string EntryName)> InstanceFiles(string dataRoot)
    {
        foreach (var folder in InstanceFolders)
        {
            var directory = Path.Combine(dataRoot, folder);
            if (!Directory.Exists(directory))
            {
                continue;
            }

            foreach (var path in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
            {
                var relative = Path.GetRelativePath(dataRoot, path).Replace(Path.DirectorySeparatorChar, '/');
                yield return (path, InstanceFolder + relative);
            }
        }
    }

    /// <summary>A key that unpacks inside the objects folder: no absolute path and no step up.</summary>
    internal static bool IsSafeKey(string key) =>
        key.Length > 0 &&
        !key.StartsWith('/') &&
        !key.Contains('\\', StringComparison.Ordinal) &&
        !key.Split('/').Any(segment => segment is "" or "." or "..");
}
