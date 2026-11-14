using System.IO.Compression;
using System.Text.Json;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Backups;

/// <summary>An archive that cannot be restored. Nothing on the data volume was changed.</summary>
public sealed class RestoreRefusedException(string message) : Exception(message);

/// <summary>
/// A restore that failed part-way and could not put the previous data back.
/// The data volume needs a person before the instance starts again.
/// </summary>
public sealed class RestoreBrokenException(string message, Exception inner) : Exception(message, inner);

/// <summary>What a restore replaced, and where the data it replaced went.</summary>
public sealed record RestoreResult(BackupManifest Manifest, string PreviousDataDirectory);

/// <summary>
/// Puts a full backup archive in place of an instance's data, while no
/// process of that instance runs.
/// </summary>
/// <remarks>
/// <para>
/// The archive is checked before anything changes: its manifest, every entry
/// name, the database's integrity and every entry's bytes. Its contents are
/// then unpacked beside the live folders, on the same volume, and only once
/// all of them are written does each live folder make way for its new one.
/// The folders it replaces are moved whole into
/// <c>restore/previous-…</c>, the database's <c>-wal</c> and <c>-shm</c>
/// with them, so the restore can be undone by moving them back.
/// </para>
/// <para>
/// Only an archive of all four parts is restored: a database without the keys
/// it was written with cannot read the secrets stored in it, and objects
/// without their rows serve nobody.
/// </para>
/// </remarks>
public static class BackupRestore
{
    /// <summary>The folder of the data volume that holds staged archives and replaced data.</summary>
    public const string FolderName = "restore";

    /// <summary>The archive the next start of the container restores.</summary>
    public const string StagedArchiveName = "staged.zip";

    /// <summary>What the last restore did or why it refused, for a person to read.</summary>
    public const string LastResultName = "last-restore.json";

    /// <summary>
    /// Left by a restore that failed part-way and could not undo itself; the
    /// container does not start while it exists.
    /// </summary>
    public const string BrokenMarkerName = "broken";

    private const string DatabaseFolder = "db";
    private const string DatabaseFile = "stellarr.db";
    private const string KeysFolder = "keys";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>Every folder of the data volume a restore replaces, in the order it replaces them.</summary>
    public static IReadOnlyList<string> ReplacedFolders { get; } =
        [DatabaseFolder, FileSystemObjectStorage.FolderName, KeysFolder, .. BackupArchive.InstanceFolders];

    /// <summary>Where the archive the next start restores sits, for a data root.</summary>
    public static string StagedArchivePath(string dataRoot) =>
        Path.Combine(dataRoot, FolderName, StagedArchiveName);

    /// <summary>
    /// Checks that <paramref name="archivePath"/> is a full backup this release
    /// can restore, reading every byte of it.
    /// </summary>
    /// <exception cref="RestoreRefusedException">It is not.</exception>
    public static async Task<BackupManifest> CheckAsync(
        string archivePath,
        string workDirectory,
        CancellationToken cancellationToken)
    {
        if (await IsDatabaseFileAsync(archivePath, cancellationToken))
        {
            throw new RestoreRefusedException(
                "This is a database-only backup: a single SQLite file, not an archive. Only a full backup is restored as a whole; restore this one by hand, as docs/admin/backups.md describes.");
        }

        BackupManifest manifest;
        try
        {
            await using var zip = await ZipFile.OpenReadAsync(archivePath, cancellationToken);
            manifest = await ReadManifestAsync(zip, cancellationToken);
            CheckEntryNames(zip);
        }
        catch (Exception exception) when (exception is InvalidDataException or IOException or JsonException)
        {
            throw new RestoreRefusedException($"The file is not a readable backup archive: {exception.Message}");
        }

        Directory.CreateDirectory(workDirectory);
        var verdict = await BackupArchive.VerifyAsync(archivePath, workDirectory, cancellationToken);
        if (verdict != "ok")
        {
            throw new RestoreRefusedException($"The archive failed its check: {verdict}");
        }

        return manifest;
    }

    /// <summary>
    /// Replaces the instance's database, files, keys and instance folders under
    /// <paramref name="dataRoot"/> with the contents of the archive.
    /// </summary>
    /// <exception cref="RestoreRefusedException">The archive cannot be restored; nothing was changed.</exception>
    /// <exception cref="RestoreBrokenException">The swap failed and could not be undone.</exception>
    public static async Task<RestoreResult> ApplyAsync(
        string archivePath,
        string dataRoot,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        dataRoot = Path.GetFullPath(dataRoot);
        var restoreFolder = Path.Combine(dataRoot, FolderName);
        ClearLeftovers(dataRoot);
        var manifest = await CheckAsync(archivePath, restoreFolder, cancellationToken);
        CheckFreeSpace(archivePath, dataRoot);

        var unpacked = Path.Combine(restoreFolder, $".unpacking-{Guid.NewGuid():N}");
        try
        {
            await UnpackAsync(archivePath, unpacked, cancellationToken);
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            TryDeleteDirectory(unpacked);
            throw new RestoreRefusedException($"The archive could not be unpacked: {exception.Message}");
        }
        catch
        {
            TryDeleteDirectory(unpacked);
            throw;
        }

        var previous = NewPreviousDirectory(restoreFolder, utcNow);
        try
        {
            Swap(dataRoot, unpacked, previous);
        }
        catch (RestoreRefusedException)
        {
            TryDeleteDirectory(unpacked);
            throw;
        }

        TryDeleteDirectory(unpacked);
        return new RestoreResult(manifest, previous);
    }

    /// <summary>
    /// Removes what a staging or a restore cut short by a stop left in the
    /// restore folder: a half-copied archive, the database copied out for its
    /// check, a half-unpacked archive. None of them is data the instance reads,
    /// and left there they would count against the next restore's space.
    /// </summary>
    public static void ClearLeftovers(string dataRoot)
    {
        var folder = Path.Combine(dataRoot, FolderName);
        if (!Directory.Exists(folder))
        {
            return;
        }

        foreach (var directory in Directory.EnumerateDirectories(folder, ".unpacking-*"))
        {
            TryDeleteDirectory(directory);
        }

        foreach (var file in Directory.EnumerateFiles(folder, ".verify-*")
                     .Concat(Directory.EnumerateFiles(folder, $"{StagedArchiveName}.*.partial")))
        {
            File.Delete(file);
        }
    }

    /// <summary>Records what the last restore did, beside the archives, for a person to read.</summary>
    public static async Task WriteResultAsync(string dataRoot, object result, CancellationToken cancellationToken)
    {
        var folder = Path.Combine(dataRoot, FolderName);
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, LastResultName);
        var pending = path + ".partial";
        await File.WriteAllTextAsync(pending, JsonSerializer.Serialize(result, Json), cancellationToken);
        File.Move(pending, path, overwrite: true);
    }

    /// <summary>Whether the file starts as every SQLite database does, as Cockpit's database-only backups are.</summary>
    private static async Task<bool> IsDatabaseFileAsync(string path, CancellationToken cancellationToken)
    {
        var header = "SQLite format 3\0"u8.ToArray();
        var start = new byte[header.Length];
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
        var read = await file.ReadAtLeastAsync(start, start.Length, throwOnEndOfStream: false, cancellationToken);
        return read == header.Length && start.AsSpan().SequenceEqual(header);
    }

    private static async Task<BackupManifest> ReadManifestAsync(ZipArchive zip, CancellationToken cancellationToken)
    {
        if (zip.GetEntry(BackupArchive.ManifestEntry) is not { } entry)
        {
            throw new RestoreRefusedException("The archive has no manifest, so it is not a Stellarr backup.");
        }

        BackupManifest? manifest;
        await using (var stream = await entry.OpenAsync(cancellationToken))
        {
            manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(stream, Json, cancellationToken);
        }

        if (manifest is null || manifest.Format != BackupManifest.FormatName)
        {
            throw new RestoreRefusedException("The archive's manifest is not a Stellarr backup's.");
        }

        if (manifest.Version > BackupManifest.CurrentVersion)
        {
            throw new RestoreRefusedException(
                $"The archive was written in backup format {manifest.Version}; this release reads up to {BackupManifest.CurrentVersion}. Restore it with the release that made it, or a newer one.");
        }

        var missing = BackupPartNames.Of(BackupParts.All).Except(manifest.Parts, StringComparer.Ordinal).ToArray();
        if (missing.Length > 0)
        {
            throw new RestoreRefusedException(
                $"The archive lacks {string.Join(", ", missing)}. Only a full backup is restored as a whole; restore a partial one by hand, as docs/admin/backups.md describes.");
        }

        return manifest;
    }

    /// <summary>
    /// Every entry has to land inside the folder it belongs to. An archive may
    /// come from anywhere, so a name that could reach elsewhere is refused
    /// rather than skipped.
    /// </summary>
    private static void CheckEntryNames(ZipArchive zip)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName;
            if (!seen.Add(name))
            {
                throw new RestoreRefusedException($"The archive holds '{name}' twice.");
            }

            if (TargetOf(name) is null)
            {
                throw new RestoreRefusedException($"The archive holds '{name}', which no part of a backup puts there.");
            }
        }
    }

    /// <summary>
    /// Where an entry unpacks, relative to the data root: empty for the
    /// manifest, which stays in the archive, and null for a name that
    /// belongs nowhere.
    /// </summary>
    private static string? TargetOf(string name)
    {
        if (name == BackupArchive.ManifestEntry)
        {
            return "";
        }

        if (name == BackupArchive.DatabaseEntry)
        {
            return Path.Combine(DatabaseFolder, DatabaseFile);
        }

        if (name.StartsWith(BackupArchive.ObjectsFolder, StringComparison.Ordinal))
        {
            var key = name[BackupArchive.ObjectsFolder.Length..];
            return ObjectKeys.IsSafe(key) && !key.StartsWith('.')
                ? Path.Combine(FileSystemObjectStorage.FolderName, key)
                : null;
        }

        if (name.StartsWith(BackupArchive.KeysFolder, StringComparison.Ordinal))
        {
            var file = name[BackupArchive.KeysFolder.Length..];
            return ObjectKeys.IsSafe(file) && !file.Contains('/', StringComparison.Ordinal)
                ? Path.Combine(KeysFolder, file)
                : null;
        }

        if (name.StartsWith(BackupArchive.InstanceFolder, StringComparison.Ordinal))
        {
            var relative = name[BackupArchive.InstanceFolder.Length..];
            var folder = relative.Split('/')[0];
            return ObjectKeys.IsSafe(relative) &&
                   relative.Length > folder.Length &&
                   BackupArchive.InstanceFolders.Contains(folder, StringComparer.Ordinal)
                ? relative
                : null;
        }

        return null;
    }

    /// <summary>
    /// The unpacked archive takes about its own size again; the folders it
    /// replaces are moved, not copied, so they cost nothing more.
    /// </summary>
    private static void CheckFreeSpace(string archivePath, string dataRoot)
    {
        long needed;
        using (var zip = ZipFile.OpenRead(archivePath))
        {
            needed = zip.Entries.Sum(entry => entry.Length);
        }

        var available = new DriveInfo(dataRoot).AvailableFreeSpace;
        if (available < needed)
        {
            throw new RestoreRefusedException(
                $"Unpacking the archive needs {needed} bytes on the data volume, and {available} are free.");
        }
    }

    private static async Task UnpackAsync(string archivePath, string unpacked, CancellationToken cancellationToken)
    {
        foreach (var folder in ReplacedFolders)
        {
            Directory.CreateDirectory(Path.Combine(unpacked, folder));
        }

        await using var zip = await ZipFile.OpenReadAsync(archivePath, cancellationToken);
        foreach (var entry in zip.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relative = TargetOf(entry.FullName);
            if (string.IsNullOrEmpty(relative))
            {
                continue;
            }

            var path = Path.Combine(unpacked, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using (var source = await entry.OpenAsync(cancellationToken))
            await using (var target = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                await source.CopyToAsync(target, cancellationToken);
                target.Flush(flushToDisk: true);
            }

            // A zip entry carries no file mode. What the container creates as
            // its owner's alone stays its owner's alone.
            if (!OperatingSystem.IsWindows() && IsPrivate(relative))
            {
                File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
        }
    }

    private static bool IsPrivate(string relative)
    {
        var folder = relative.Split(Path.DirectorySeparatorChar)[0];
        return folder is KeysFolder or "secrets" or "tls";
    }

    /// <summary>
    /// Moves each live folder into <paramref name="previous"/> and its
    /// unpacked replacement into its place. Renames within one volume either
    /// happen or do not, so a failure leaves a known list of moves to undo.
    /// </summary>
    private static void Swap(string dataRoot, string unpacked, string previous)
    {
        Directory.CreateDirectory(previous);
        var done = new Stack<(string From, string To)>();
        try
        {
            foreach (var folder in ReplacedFolders)
            {
                var live = Path.Combine(dataRoot, folder);
                if (Directory.Exists(live))
                {
                    Directory.Move(live, Path.Combine(previous, folder));
                    done.Push((live, Path.Combine(previous, folder)));
                }

                Directory.Move(Path.Combine(unpacked, folder), live);
                done.Push((Path.Combine(unpacked, folder), live));
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            try
            {
                while (done.TryPop(out var move))
                {
                    Directory.Move(move.To, move.From);
                }
            }
            catch (Exception undo) when (undo is IOException or UnauthorizedAccessException)
            {
                throw new RestoreBrokenException(
                    $"Putting the archive in place failed ({exception.Message}), and so did putting the previous data back ({undo.Message}). The previous folders are in {previous}; the archive's are in {unpacked}.",
                    undo);
            }

            TryDeleteDirectory(previous);
            throw new RestoreRefusedException($"The archive could not be put in place: {exception.Message}");
        }
    }

    /// <summary>A new folder for the data a restore replaces, named for when it was replaced.</summary>
    private static string NewPreviousDirectory(string restoreFolder, DateTime utcNow)
    {
        var name = $"previous-{utcNow:yyyyMMdd-HHmmss}";
        var path = Path.Combine(restoreFolder, name);
        for (var attempt = 2; Directory.Exists(path); attempt++)
        {
            path = Path.Combine(restoreFolder, $"{name}-{attempt}");
        }

        return path;
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Left for a person; it holds nothing the instance reads.
        }
    }
}
