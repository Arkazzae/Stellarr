using Stellarr.Api.Backups;

namespace Stellarr.Cli;

/// <summary>
/// Checks backup archives and restores one. A restore is staged while the
/// instance runs and put in place by the container's next start, before any
/// service reads the data volume; while the instance runs, its database, keys
/// and secrets are open, and replacing them under it would mix two instances.
/// </summary>
internal static class BackupCommands
{
    /// <summary>The folder Cockpit and the automatic backups write archives to.</summary>
    private const string LocalBackupsFolder = "backups";

    internal sealed record BackupSummary(
        string Archive,
        DateTime CreatedAt,
        string InstanceName,
        long DatabaseBytes,
        int ObjectCount,
        long ObjectBytes,
        int MissingObjects,
        int KeyFiles,
        int InstanceFiles,
        IReadOnlyList<string> EnvironmentSecrets);

    internal static async Task<CliResult> VerifyAsync(
        CliRuntime runtime,
        string archive,
        CancellationToken cancellationToken)
    {
        var path = ResolveArchive(runtime, archive);
        var manifest = await CheckAsync(path, cancellationToken);
        var summary = Summarize(path, manifest);
        return new CliResult(
            "backup.verify",
            summary,
            [
                $"{path} is a full backup of {manifest.InstanceName} from {manifest.CreatedAt:u}, and this release can restore it.",
                .. Describe(summary),
            ],
            Warnings: Warnings(summary));
    }

    internal static async Task<CliResult> RestoreAsync(
        CliRuntime runtime,
        string archive,
        CancellationToken cancellationToken)
    {
        var path = ResolveArchive(runtime, archive);
        var manifest = await CheckAsync(path, cancellationToken);
        var summary = Summarize(path, manifest);
        var staged = BackupRestore.StagedArchivePath(runtime.DataRoot);
        var replacing = File.Exists(staged);
        runtime.Confirm(
            $"At the container's next start, the database, uploaded files, keys, secrets, TLS files and desktop releases under {runtime.DataRoot} " +
            $"will be replaced by the backup of {manifest.InstanceName} from {manifest.CreatedAt:u}. Everything written since then is lost. " +
            $"The current data is kept in {Path.Combine(runtime.DataRoot, BackupRestore.FolderName)}/previous-<time>." +
            (replacing ? " This replaces the backup staged before." : ""));

        var folder = Path.GetDirectoryName(staged)!;
        Directory.CreateDirectory(folder);
        var size = new FileInfo(path).Length;
        var available = new DriveInfo(folder).AvailableFreeSpace;
        if (available < size)
        {
            throw new CliException(
                "not_enough_space",
                $"Staging the archive needs {size} bytes on the data volume, and {available} are free. Nothing was staged.",
                CliExit.Conflict);
        }

        // Copied, not moved: the archive may be one Cockpit lists, and the
        // copy lives on the data volume, which a recreated container keeps.
        var partial = $"{staged}.{Guid.NewGuid():N}.partial";
        try
        {
            await using (var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true))
            await using (var target = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                await source.CopyToAsync(target, cancellationToken);
                target.Flush(flushToDisk: true);
            }

            File.Move(partial, staged, overwrite: true);
        }
        catch
        {
            File.Delete(partial);
            throw;
        }

        return new CliResult(
            "backup.restore",
            new { staged, backup = summary },
            [
                $"Staged the backup of {manifest.InstanceName} from {manifest.CreatedAt:u}.",
                "Restart the container to restore it, for example: docker compose restart stellarr",
                "Until then, 'stellarr backup cancel' drops it.",
            ],
            Warnings: Warnings(summary));
    }

    internal static Task<CliResult> CancelAsync(CliRuntime runtime)
    {
        var staged = BackupRestore.StagedArchivePath(runtime.DataRoot);
        if (!File.Exists(staged))
        {
            throw NothingStaged(staged);
        }

        runtime.Confirm($"Will drop the staged backup {staged}; the next start keeps the current data.");
        File.Delete(staged);
        return Task.FromResult(new CliResult(
            "backup.cancel",
            new { staged },
            ["Dropped the staged backup. The next start keeps the current data."]));
    }

    /// <summary>
    /// Puts the staged backup in place. The container's entrypoint runs this
    /// before it starts any service; it refuses while the API answers.
    /// </summary>
    internal static async Task<CliResult> ApplyAsync(CliRuntime runtime, CancellationToken cancellationToken)
    {
        var staged = BackupRestore.StagedArchivePath(runtime.DataRoot);
        if (!File.Exists(staged))
        {
            throw NothingStaged(staged);
        }

        var api = await LocalApi.ProbeAsync(runtime, cancellationToken);
        if (api.Available)
        {
            throw new CliException(
                "instance_running",
                $"The API answers at {api.Url}, so the instance is running and its data is in use. The staged backup is restored by the container's next start; restart the container instead.",
                CliExit.Conflict);
        }

        runtime.Confirm($"Will replace the instance's data under {runtime.DataRoot} with the staged backup now.");
        var now = DateTime.UtcNow;
        var folder = Path.GetDirectoryName(staged)!;
        try
        {
            var result = await BackupRestore.ApplyAsync(staged, runtime.DataRoot, now, cancellationToken);
            File.Delete(staged);
            var summary = Summarize(staged, result.Manifest);
            await BackupRestore.WriteResultAsync(
                runtime.DataRoot,
                new { outcome = "restored", at = now, backup = summary, previousData = result.PreviousDataDirectory },
                cancellationToken);
            return new CliResult(
                "backup.apply",
                new { backup = summary, previousData = result.PreviousDataDirectory },
                [
                    $"Restored the backup of {result.Manifest.InstanceName} from {result.Manifest.CreatedAt:u}.",
                    $"The data it replaced is in {result.PreviousDataDirectory}; delete it once the instance looks right.",
                ],
                Warnings: Warnings(summary));
        }
        catch (RestoreRefusedException refused)
        {
            var kept = Path.Combine(folder, $"refused-{now:yyyyMMdd-HHmmss}.zip");
            File.Move(staged, kept, overwrite: true);
            await BackupRestore.WriteResultAsync(
                runtime.DataRoot,
                new { outcome = "refused", at = now, reason = refused.Message, archive = kept },
                CancellationToken.None);
            throw new CliException(
                "restore_refused",
                $"{refused.Message} The data was left as it was; the archive is kept as {kept}.",
                CliExit.Conflict);
        }
        catch (RestoreBrokenException broken)
        {
            // The entrypoint refuses to start while this marker exists, so a
            // half-swapped volume is never served.
            var marker = Path.Combine(folder, BackupRestore.BrokenMarkerName);
            await File.WriteAllTextAsync(marker, broken.Message, CancellationToken.None);
            File.Move(staged, Path.Combine(folder, $"broken-{now:yyyyMMdd-HHmmss}.zip"), overwrite: true);
            await BackupRestore.WriteResultAsync(
                runtime.DataRoot,
                new { outcome = "broken", at = now, reason = broken.Message },
                CancellationToken.None);
            throw new CliException(
                "restore_broken",
                $"{broken.Message} The container will not start until {marker} is removed.",
                CliExit.Failure);
        }
    }

    /// <summary>A path as given, or the name of an archive in the instance's own backups folder.</summary>
    private static string ResolveArchive(CliRuntime runtime, string archive)
    {
        if (File.Exists(archive))
        {
            return Path.GetFullPath(archive);
        }

        var local = Path.Combine(runtime.DataRoot, LocalBackupsFolder, archive);
        if (Path.GetFileName(archive) == archive && File.Exists(local))
        {
            return local;
        }

        throw new CliException(
            "backup_not_found",
            $"No archive exists at {archive}, nor under that name in {Path.Combine(runtime.DataRoot, LocalBackupsFolder)}.",
            CliExit.NotFound);
    }

    private static async Task<BackupManifest> CheckAsync(string path, CancellationToken cancellationToken)
    {
        // The database is copied out of the archive to be checked; the system
        // temp folder keeps that copy off the data volume.
        var work = Path.Combine(Path.GetTempPath(), $"stellarr-backup-check-{Guid.NewGuid():N}");
        try
        {
            return await BackupRestore.CheckAsync(path, work, cancellationToken);
        }
        catch (RestoreRefusedException refused)
        {
            throw new CliException("backup_refused", refused.Message, CliExit.Conflict);
        }
        finally
        {
            if (Directory.Exists(work))
            {
                Directory.Delete(work, recursive: true);
            }
        }
    }

    private static BackupSummary Summarize(string path, BackupManifest manifest) => new(
        path,
        manifest.CreatedAt,
        manifest.InstanceName,
        manifest.DatabaseBytes,
        manifest.ObjectCount,
        manifest.ObjectBytes,
        manifest.MissingObjects.Count,
        manifest.KeyFiles,
        manifest.InstanceFiles,
        manifest.EnvironmentSecrets);

    private static IEnumerable<string> Describe(BackupSummary summary) =>
    [
        $"Database: {summary.DatabaseBytes} bytes.",
        $"Uploaded files: {summary.ObjectCount} ({summary.ObjectBytes} bytes).",
        $"Key files: {summary.KeyFiles}. Instance files: {summary.InstanceFiles}.",
    ];

    private static List<string> Warnings(BackupSummary summary)
    {
        var warnings = new List<string>();
        if (summary.MissingObjects > 0)
        {
            warnings.Add($"{summary.MissingObjects} uploaded files could not be read when the backup was made and are not in it.");
        }

        if (summary.EnvironmentSecrets.Count > 0)
        {
            warnings.Add(
                $"These secrets came from the environment and are not in the archive; keep them in .env: {string.Join(", ", summary.EnvironmentSecrets)}.");
        }

        return warnings;
    }

    private static CliException NothingStaged(string staged) => new(
        "restore_not_staged",
        $"No backup is staged for restore ({staged} does not exist); nothing changed.",
        CliExit.NotFound);
}
