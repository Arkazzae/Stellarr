using System.Globalization;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Endpoints;
using Stellarr.Api.Localization;
using Stellarr.Api.Secrets;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Backups;

/// <summary>A backup being written.</summary>
public sealed record BackupJob(string Id, BackupParts Parts, DateTime StartedAt, BackupProgress Progress)
{
    internal TaskCompletionSource<bool> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}

/// <summary>Why the last backup did not finish.</summary>
public sealed record BackupFailure(string Id, string Message, DateTime At);

/// <summary>
/// Runs one archive backup at a time, outside the request that asked for it:
/// with every object of the store it can take minutes. The archive is written
/// under a name the backup list ignores and renamed once complete, so the list
/// never shows half a backup.
/// </summary>
public sealed partial class BackupJobs(
    IServiceScopeFactory scopes,
    IConfiguration configuration,
    IHostApplicationLifetime lifetime,
    ILogger<BackupJobs> logger)
{
    public const string ArchiveExtension = ".zip";
    private const string PartialPrefix = ".";
    private const string PartialExtension = ".partial";

    /// <summary>Room kept free beyond the estimate, for the snapshot and the zip's own records.</summary>
    private const double SpaceMargin = 1.1;

    private readonly Lock _gate = new();
    private BackupJob? _running;
    private BackupFailure? _lastFailure;

    public BackupJob? Running
    {
        get
        {
            lock (_gate) return _running;
        }
    }

    public BackupFailure? LastFailure
    {
        get
        {
            lock (_gate) return _lastFailure;
        }
    }

    public static string Directory(IConfiguration configuration) =>
        Path.GetFullPath(Path.Combine(configuration["DataRoot"] ?? "data", "backups"));

    /// <summary>Removes what a backup interrupted by a stop left behind.</summary>
    public static void RemoveLeftovers(string directory)
    {
        if (!System.IO.Directory.Exists(directory))
        {
            return;
        }

        // With the side files SQLite may leave next to a partial copy (-wal, -shm).
        foreach (var path in System.IO.Directory.EnumerateFiles(directory, $"{PartialPrefix}*{PartialExtension}*"))
        {
            File.Delete(path);
        }
    }

    /// <returns>The started job, or null while another one runs.</returns>
    public BackupJob? TryStart(BackupParts parts, Guid serverId, Guid actorId, bool automatic = false)
    {
        BackupJob job;
        lock (_gate)
        {
            if (_running is not null)
            {
                return null;
            }

            var id = string.Create(
                CultureInfo.InvariantCulture,
                $"backup-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}{ArchiveExtension}");
            job = new BackupJob(id, parts, DateTime.UtcNow, new BackupProgress());
            _running = job;
        }

        _ = Task.Run(() => RunAsync(job, serverId, actorId, automatic, lifetime.ApplicationStopping));
        return job;
    }

    private async Task RunAsync(BackupJob job, Guid serverId, Guid actorId, bool automatic, CancellationToken cancellationToken)
    {
        var directory = Directory(configuration);
        var partial = Path.Combine(directory, PartialPrefix + job.Id + PartialExtension);
        var succeeded = false;
        try
        {
            System.IO.Directory.CreateDirectory(directory);
            await using var scope = scopes.CreateAsyncScope();
            var services = scope.ServiceProvider;
            var db = services.GetRequiredService<AppDbContext>();
            var storage = services.GetRequiredService<IObjectStorage>();
            var messages = services.GetRequiredService<Messages>();

            IReadOnlyList<StoredObjectInfo> objects = [];
            if (job.Parts.HasFlag(BackupParts.Objects))
            {
                try
                {
                    objects = await ListAsync(storage, cancellationToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    throw new BackupFailedException(messages.Get(MessageKey.CockpitBackupStorageUnreadable, ("reason", exception.Message)));
                }
            }

            var progress = new BackupProgress { ObjectsTotal = objects.Count };
            lock (_gate)
            {
                _running = job with { Progress = progress };
            }

            var connectionString = db.Database.GetDbConnection().ConnectionString;
            var keysDirectory = KeysDirectory(services);
            var dataRoot = Path.GetFullPath(configuration["DataRoot"] ?? "data");
            EnsureSpace(directory, Estimate(job.Parts, connectionString, objects, keysDirectory, dataRoot), messages);

            var server = await db.Servers.AsNoTracking().SingleAsync(x => x.Id == serverId, cancellationToken);
            var resolved = await services.GetRequiredService<InstanceSecrets>().ReadAsync(cancellationToken);
            var environmentSecrets = SecretNames.All
                .Where(definition => resolved[definition.Name].Source == SecretSource.Environment)
                .Select(definition => definition.Variable)
                .ToArray();

            var manifest = await BackupArchive.WriteAsync(
                partial,
                job.Parts,
                new BackupSources(connectionString, storage, objects, keysDirectory, server.Name, environmentSecrets, directory, dataRoot),
                progress,
                cancellationToken);
            if (automatic)
            {
                if (manifest.MissingObjects.Count > 0)
                {
                    throw new BackupFailedException("Automatic backup contains missing objects.");
                }

                var verdict = await BackupArchive.VerifyAsync(partial, directory, cancellationToken);
                if (verdict != "ok") throw new BackupFailedException(verdict);
            }
            File.Move(partial, Path.Combine(directory, job.Id));
            if (automatic)
            {
                await File.WriteAllTextAsync(Path.Combine(directory, job.Id) + ".verified",
                    DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture), cancellationToken);
            }

            await CockpitEndpoints.StageAuditAsync(
                db, serverId, actorId,
                (automatic ? "[automatic] " : "") + messages.Get(MessageKey.AuditBackupCreated, ("id", job.Id)), cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            lock (_gate)
            {
                _lastFailure = null;
            }
            succeeded = true;
        }
        catch (Exception exception)
        {
            File.Delete(partial);
            if (exception is OperationCanceledException && cancellationToken.IsCancellationRequested)
            {
                return;
            }

            LogFailed(logger, job.Id, exception);
            lock (_gate)
            {
                _lastFailure = new BackupFailure(job.Id, exception.Message, DateTime.UtcNow);
            }
        }
        finally
        {
            lock (_gate)
            {
                _running = null;
            }
            job.Completion.TrySetResult(succeeded);
        }
    }

    /// <summary>
    /// The folder the data-protection keys are kept in, as the key manager uses
    /// it, rather than worked out again from the configuration.
    /// </summary>
    private string KeysDirectory(IServiceProvider services) =>
        services.GetRequiredService<IOptions<KeyManagementOptions>>().Value.XmlRepository is FileSystemXmlRepository repository
            ? repository.Directory.FullName
            : Path.Combine(configuration["DataRoot"] ?? "data", "keys");

    private static async Task<IReadOnlyList<StoredObjectInfo>> ListAsync(IObjectStorage storage, CancellationToken cancellationToken)
    {
        var objects = new List<StoredObjectInfo>();
        await foreach (var item in storage.ListAsync(cancellationToken))
        {
            objects.Add(item);
        }

        return objects;
    }

    /// <summary>About how many bytes the archive will take, before the zip compresses the database.</summary>
    private static long Estimate(
        BackupParts parts,
        string connectionString,
        IReadOnlyList<StoredObjectInfo> objects,
        string keysDirectory,
        string dataRoot)
    {
        var bytes = 0L;
        if (parts.HasFlag(BackupParts.Database))
        {
            var database = new SqliteConnectionStringBuilder(connectionString).DataSource;
            // The snapshot and its copy in the archive are both on this disk for a moment.
            bytes += 2 * (SizeOf(database) + SizeOf(database + "-wal"));
        }

        if (parts.HasFlag(BackupParts.Objects))
        {
            bytes += objects.Sum(x => x.Size);
        }

        if (parts.HasFlag(BackupParts.Keys) && System.IO.Directory.Exists(keysDirectory))
        {
            bytes += System.IO.Directory.EnumerateFiles(keysDirectory).Sum(SizeOf);
        }

        if (parts.HasFlag(BackupParts.Instance))
        {
            bytes += BackupArchive.InstanceFiles(dataRoot).Sum(file => SizeOf(file.Path));
        }

        return bytes;
    }

    private static long SizeOf(string path) => File.Exists(path) ? new FileInfo(path).Length : 0;

    private static void EnsureSpace(string directory, long estimate, Messages messages)
    {
        var free = new DriveInfo(directory).AvailableFreeSpace;
        var needed = (long)(estimate * SpaceMargin);
        if (needed > free)
        {
            throw new BackupFailedException(messages.Get(
                MessageKey.CockpitBackupNoSpace,
                ("needed", Megabytes(needed)),
                ("free", Megabytes(free))));
        }
    }

    private static string Megabytes(long bytes) =>
        (bytes / 1024d / 1024d).ToString("0.#", CultureInfo.InvariantCulture) + " MB";

    [LoggerMessage(Level = LogLevel.Error, Message = "Backup {BackupId} failed")]
    private static partial void LogFailed(ILogger logger, string backupId, Exception exception);
}
