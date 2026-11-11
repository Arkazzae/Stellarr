using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Backups;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

// Backups, kept as files in {DataRoot}/backups: online copies of the database
// as plain SQLite files, and archives that add the stored files and the keys.
public static partial class CockpitEndpoints
{
    private const int DefaultBackupRetentionDays = 14;
    private const string BackupPrefix = "backup-";
    private const string BackupExtension = ".db";
    private const string VerifiedMarkerExtension = ".verified";

    private static async Task<IResult> GetBackupsAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        BackupJobs jobs,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        var retentionDays = await db.OperationsSettings.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .Select(x => (int?)x.BackupRetentionDays)
            .SingleOrDefaultAsync(cancellationToken);
        var running = jobs.Running;
        var failure = jobs.LastFailure;
        return Results.Ok(new CockpitBackupsDto(
            await ReadBackupsAsync(BackupDirectory(configuration), cancellationToken),
            retentionDays ?? DefaultBackupRetentionDays,
            running is null ? null : ToJobDto(running),
            failure is null ? null : new CockpitBackupFailureDto(failure.Id, failure.Message, failure.At)));
    }

    /// <summary>
    /// Without a body: the database alone, copied at once into a plain SQLite
    /// file. With one naming the files or the keys: an archive written in the
    /// background, answered with 202 and followed through the backup list.
    /// </summary>
    private static async Task<IResult> CreateBackupAsync(
        CreateCockpitBackupRequest? request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        BackupJobs jobs,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var parts = request is null
            ? BackupParts.Database
            : (request.Database ? BackupParts.Database : BackupParts.None)
                | (request.Objects ? BackupParts.Objects : BackupParts.None)
                | (request.Keys ? BackupParts.Keys : BackupParts.None);
        if (parts == BackupParts.None)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["parts"] = [messages.Get(MessageKey.CockpitBackupNoParts)],
            });
        }

        if (parts != BackupParts.Database)
        {
            return jobs.TryStart(parts, server.Id, http.User.RequireUserId()) is { } job
                ? Results.Accepted($"/api/cockpit/backups/{job.Id}", ToJobDto(job))
                : Results.Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: messages.Get(MessageKey.CockpitBackupRunning));
        }

        var directory = BackupDirectory(configuration);
        Directory.CreateDirectory(directory);
        var id = $"{BackupPrefix}{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}{BackupExtension}";
        var path = Path.Combine(directory, id);

        // Copied from the database this server is using, not from the setting it
        // was configured with, so that a backup is always of the live data.
        await CopyDatabaseAsync(db.Database.GetDbConnection().ConnectionString, path, cancellationToken);

        await StageAuditAsync(
            db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditBackupCreated, ("id", id)), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var file = new FileInfo(path);
        return Results.Created(
            $"/api/cockpit/backups/{id}",
            new CockpitBackupDto(id, file.Length, file.CreationTimeUtc, null, [BackupPartNames.Database], 0));
    }

    private static CockpitBackupJobDto ToJobDto(BackupJob job) => new(
        job.Id,
        BackupPartNames.Of(job.Parts),
        job.StartedAt,
        job.Progress.Phase,
        job.Progress.ObjectsDone,
        job.Progress.ObjectsTotal);

    private static async Task<IResult> VerifyBackupAsync(
        string backupId,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (ResolveBackup(configuration, backupId) is not { } path || !File.Exists(path))
        {
            return Results.NotFound();
        }

        var verdict = IsArchive(path)
            ? await BackupArchive.VerifyAsync(path, BackupDirectory(configuration), cancellationToken)
            : await CheckIntegrityAsync(path, cancellationToken);
        if (!string.Equals(verdict, "ok", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitBackupFailedIntegrity),
                detail: verdict);
        }

        var verifiedAt = DateTime.UtcNow;
        await File.WriteAllTextAsync(
            path + VerifiedMarkerExtension,
            verifiedAt.ToString("O", CultureInfo.InvariantCulture),
            cancellationToken);
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditBackupVerified, ("id", backupId)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(await ToBackupDtoAsync(path, cancellationToken));
    }

    private static IResult DownloadBackup(string backupId, IConfiguration configuration) =>
        ResolveBackup(configuration, backupId) is { } path && File.Exists(path)
            ? Results.File(
                path,
                IsArchive(path) ? "application/zip" : "application/vnd.sqlite3",
                backupId,
                enableRangeProcessing: true)
            : Results.NotFound();

    private static bool IsArchive(string path) =>
        path.EndsWith(BackupJobs.ArchiveExtension, StringComparison.Ordinal);

    /// <summary>
    /// Copies a live SQLite database into a new file with SQLite's online
    /// backup, which yields a consistent snapshot while writers keep working.
    /// A copy that fails is removed: a half-written file would otherwise sit in
    /// the list as a backup.
    /// </summary>
    internal static async Task CopyDatabaseAsync(
        string sourceConnectionString,
        string destinationPath,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var source = new SqliteConnection(sourceConnectionString);
            await using var destination = new SqliteConnection(PlainFile(destinationPath, SqliteOpenMode.ReadWriteCreate));
            await source.OpenAsync(cancellationToken);
            await destination.OpenAsync(cancellationToken);
            source.BackupDatabase(destination);
        }
        catch
        {
            File.Delete(destinationPath);
            throw;
        }
    }

    /// <returns>"ok", or what SQLite found wrong with the file.</returns>
    internal static async Task<string?> CheckIntegrityAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = new SqliteConnection(PlainFile(path, SqliteOpenMode.ReadOnly));
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA integrity_check;";
            return await command.ExecuteScalarAsync(cancellationToken) as string;
        }
        catch (SqliteException exception)
        {
            // A file that is not a database at all fails before the check can answer.
            return exception.Message;
        }
    }

    /// <summary>A connection to one file that is not pooled, so that closing it releases the file.</summary>
    private static string PlainFile(string path, SqliteOpenMode mode) =>
        new SqliteConnectionStringBuilder { DataSource = path, Mode = mode, Pooling = false }.ToString();

    private static string BackupDirectory(IConfiguration configuration) => BackupJobs.Directory(configuration);

    /// <returns>The file a backup id names, or null when the id is not a plain backup file name.</returns>
    private static string? ResolveBackup(IConfiguration configuration, string backupId) =>
        string.Equals(Path.GetFileName(backupId), backupId, StringComparison.Ordinal) &&
        backupId.StartsWith(BackupPrefix, StringComparison.Ordinal) &&
        (backupId.EndsWith(BackupExtension, StringComparison.Ordinal) ||
            backupId.EndsWith(BackupJobs.ArchiveExtension, StringComparison.Ordinal))
            ? Path.Combine(BackupDirectory(configuration), backupId)
            : null;

    private static async Task<CockpitBackupDto[]> ReadBackupsAsync(string directory, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(directory))
        {
            return [];
        }

        var backups = new List<CockpitBackupDto>();
        foreach (var path in Directory.EnumerateFiles(directory, $"{BackupPrefix}*", SearchOption.TopDirectoryOnly))
        {
            if (path.EndsWith(BackupExtension, StringComparison.Ordinal) || IsArchive(path))
            {
                backups.Add(await ToBackupDtoAsync(path, cancellationToken));
            }
        }

        return [.. backups.OrderByDescending(x => x.CreatedAt)];
    }

    /// <summary>A backup file as the list shows it; an archive says what it holds in its manifest.</summary>
    private static async Task<CockpitBackupDto> ToBackupDtoAsync(string path, CancellationToken cancellationToken)
    {
        var file = new FileInfo(path);
        var manifest = IsArchive(path) ? await BackupArchive.ReadManifestAsync(path, cancellationToken) : null;
        return new CockpitBackupDto(
            file.Name,
            file.Length,
            file.CreationTimeUtc,
            ReadVerifiedAt(path),
            manifest?.Parts ?? (IsArchive(path) ? [] : [BackupPartNames.Database]),
            manifest?.MissingObjects.Count ?? 0);
    }

    private static DateTime? ReadVerifiedAt(string backupPath)
    {
        var marker = backupPath + VerifiedMarkerExtension;
        return File.Exists(marker) && DateTime.TryParse(
            File.ReadAllText(marker),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var verifiedAt)
            ? verifiedAt.ToUniversalTime()
            : null;
    }
}
