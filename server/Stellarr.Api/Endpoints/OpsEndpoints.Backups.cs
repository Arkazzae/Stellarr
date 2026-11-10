using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;

namespace Stellarr.Api.Endpoints;

// Online copies of the database, kept as files in {DataRoot}/backups.
public static partial class OpsEndpoints
{
    private const int DefaultBackupRetentionDays = 14;
    private const string BackupPrefix = "backup-";
    private const string BackupExtension = ".db";
    private const string VerifiedMarkerExtension = ".verified";

    private static async Task<IResult> GetBackupsAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        var retentionDays = await db.OperationsSettings.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .Select(x => (int?)x.BackupRetentionDays)
            .SingleOrDefaultAsync(cancellationToken);
        return Results.Ok(new OpsBackupsDto(
            ReadBackups(BackupDirectory(configuration)),
            retentionDays ?? DefaultBackupRetentionDays));
    }

    private static async Task<IResult> CreateBackupAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var directory = BackupDirectory(configuration);
        Directory.CreateDirectory(directory);
        var id = $"{BackupPrefix}{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}{BackupExtension}";
        var path = Path.Combine(directory, id);

        // Copied from the database this server is using, not from the setting it
        // was configured with, so that a backup is always of the live data.
        await CopyDatabaseAsync(db.Database.GetDbConnection().ConnectionString, path, cancellationToken);

        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), $"utworzył(a) backup {id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var file = new FileInfo(path);
        return Results.Created(
            $"/api/ops/backups/{id}",
            new OpsBackupDto(id, file.Length, file.CreationTimeUtc, null));
    }

    private static async Task<IResult> VerifyBackupAsync(
        string backupId,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (ResolveBackup(configuration, backupId) is not { } path || !File.Exists(path))
        {
            return Results.NotFound();
        }

        var verdict = await CheckIntegrityAsync(path, cancellationToken);
        if (!string.Equals(verdict, "ok", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Backup nie przeszedł kontroli integralności.",
                detail: verdict);
        }

        var verifiedAt = DateTime.UtcNow;
        await File.WriteAllTextAsync(
            path + VerifiedMarkerExtension,
            verifiedAt.ToString("O", CultureInfo.InvariantCulture),
            cancellationToken);
        await StageAuditAsync(
            db, server.Id, http.User.RequireUserId(), $"zweryfikował(a) backup {backupId}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var file = new FileInfo(path);
        return Results.Ok(new OpsBackupDto(backupId, file.Length, file.CreationTimeUtc, verifiedAt));
    }

    private static IResult DownloadBackup(string backupId, IConfiguration configuration) =>
        ResolveBackup(configuration, backupId) is { } path && File.Exists(path)
            ? Results.File(path, "application/vnd.sqlite3", backupId, enableRangeProcessing: true)
            : Results.NotFound();

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
    private static async Task<string?> CheckIntegrityAsync(string path, CancellationToken cancellationToken)
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

    private static string BackupDirectory(IConfiguration configuration) =>
        Path.GetFullPath(Path.Combine(configuration["DataRoot"] ?? "data", "backups"));

    /// <returns>The file a backup id names, or null when the id is not a plain backup file name.</returns>
    private static string? ResolveBackup(IConfiguration configuration, string backupId) =>
        string.Equals(Path.GetFileName(backupId), backupId, StringComparison.Ordinal) &&
        backupId.StartsWith(BackupPrefix, StringComparison.Ordinal) &&
        backupId.EndsWith(BackupExtension, StringComparison.Ordinal)
            ? Path.Combine(BackupDirectory(configuration), backupId)
            : null;

    private static OpsBackupDto[] ReadBackups(string directory)
    {
        if (!Directory.Exists(directory))
        {
            return [];
        }

        return Directory.EnumerateFiles(directory, $"{BackupPrefix}*{BackupExtension}", SearchOption.TopDirectoryOnly)
            .Select(path =>
            {
                var file = new FileInfo(path);
                return new OpsBackupDto(file.Name, file.Length, file.CreationTimeUtc, ReadVerifiedAt(path));
            })
            .OrderByDescending(x => x.CreatedAt)
            .ToArray();
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
