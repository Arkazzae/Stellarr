using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Stellarr.Cli;

internal static class StatusCommands
{
    internal static async Task<CliResult> StatusAsync(CliRuntime runtime, CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken);
        var now = DateTime.UtcNow;
        var users = await db.Users.AsNoTracking().CountAsync(cancellationToken);
        var activeSessions = await db.UserSessions.AsNoTracking()
            .CountAsync(x => x.RevokedAt == null && x.ExpiresAt > now, cancellationToken);
        var api = await LocalApi.ProbeAsync(runtime, cancellationToken);
        var info = new FileInfo(runtime.DatabasePath);
        var healthy = api.Available;

        var data = new
        {
            healthy,
            dataRoot = runtime.DataRoot,
            database = new
            {
                path = runtime.DatabasePath,
                ready = true,
                schemaCompatible = true,
                sizeBytes = info.Length,
            },
            instance = new
            {
                id = server.Id.ToString(),
                name = server.Name,
                users,
                activeSessions,
            },
            api = new
            {
                url = api.Url,
                available = api.Available,
                statusCode = api.StatusCode,
                detail = api.Detail,
            },
        };

        return new CliResult(
            "status",
            data,
            [
                $"Instance: {server.Name}",
                $"Database: ready ({runtime.DatabasePath}, {info.Length} bytes)",
                $"Accounts: {users}; active sessions: {activeSessions}",
                $"Local API: {(api.Available ? "ready" : "not reachable")} ({api.Url})",
            ],
            healthy ? CliExit.Success : CliExit.Failure);
    }

    internal static async Task<CliResult> DoctorAsync(CliRuntime runtime, CancellationToken cancellationToken)
    {
        var checks = new List<DoctorCheck>
        {
            CheckDirectory("data-root", runtime.DataRoot),
            CheckKeys(runtime),
            CheckDisk(runtime.DataRoot),
            await CheckDatabaseAsync(runtime, cancellationToken),
        };
        var api = await LocalApi.ProbeAsync(runtime, cancellationToken);
        checks.Add(new DoctorCheck(
            "local-api",
            api.Available ? "ok" : "warn",
            api.Available
                ? $"ready at {api.Url}"
                : $"not reachable at {api.Url}; expected when the instance is stopped or still starting"));

        var failed = checks.Any(check => check.Status == "fail");
        var exit = !runtime.DatabaseExists
            ? CliExit.NotFound
            : checks.Any(check => check.Name == "schema" && check.Status == "fail")
                ? CliExit.Conflict
                : failed ? CliExit.Failure : CliExit.Success;
        var lines = checks.Select(check => $"[{check.Status}] {check.Name}: {check.Detail}").ToList();
        return new CliResult(
            "doctor",
            new
            {
                healthy = !failed,
                dataRoot = runtime.DataRoot,
                checks,
            },
            lines,
            exit);
    }

    private static DoctorCheck CheckDirectory(string name, string path) => Directory.Exists(path)
        ? new DoctorCheck(name, "ok", $"{path} exists")
        : new DoctorCheck(name, "fail", $"{path} does not exist");

    private static DoctorCheck CheckKeys(CliRuntime runtime)
    {
        if (!Directory.Exists(runtime.KeysDirectory))
        {
            return new DoctorCheck(
                "keys",
                "warn",
                $"{runtime.KeysDirectory} does not exist; read commands will not create it, and secrets cannot be written until the API creates it");
        }

        var keys = Directory.EnumerateFiles(runtime.KeysDirectory, "*.xml", SearchOption.TopDirectoryOnly).Count();
        return keys == 0
            ? new DoctorCheck("keys", "warn", $"{runtime.KeysDirectory} has no data-protection key files yet")
            : new DoctorCheck("keys", "ok", $"{runtime.KeysDirectory} has {keys} data-protection key file(s)");
    }

    private static DoctorCheck CheckDisk(string dataRoot)
    {
        try
        {
            var full = Path.GetFullPath(dataRoot);
            var drives = DriveInfo.GetDrives();
            var root = LongestMatchingRoot(
                full,
                drives.Select(drive => drive.RootDirectory.FullName)) ??
                Path.GetPathRoot(full) ??
                full;
            var drive = drives.FirstOrDefault(
                    candidate => string.Equals(candidate.RootDirectory.FullName, root, StringComparison.Ordinal)) ??
                new DriveInfo(root);
            var free = drive.AvailableFreeSpace;
            var status = free >= 1024L * 1024 * 1024 ? "ok" : free >= 100L * 1024 * 1024 ? "warn" : "fail";
            return new DoctorCheck("disk", status, $"{free} bytes free on {root} for {full}");
        }
        catch (Exception exception) when (exception is ArgumentException or IOException or UnauthorizedAccessException)
        {
            return new DoctorCheck("disk", "warn", "free space could not be read");
        }
    }

    /// <summary>
    /// The filesystem with the longest mount path containing <paramref name="path"/>,
    /// so a separately mounted data volume is checked instead of the root overlay.
    /// </summary>
    internal static string? LongestMatchingRoot(string path, IEnumerable<string> roots) =>
        roots.Where(root => IsWithin(path, root))
            .MaxBy(root => root.Length);

    private static bool IsWithin(string path, string root)
    {
        if (string.Equals(path, root, StringComparison.Ordinal))
        {
            return true;
        }

        var prefix = root.EndsWith(Path.DirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;
        return path.StartsWith(prefix, StringComparison.Ordinal);
    }

    private static async Task<DoctorCheck> CheckDatabaseAsync(
        CliRuntime runtime,
        CancellationToken cancellationToken)
    {
        if (!runtime.DatabaseExists)
        {
            return new DoctorCheck(
                "database",
                "fail",
                $"no database at {runtime.DatabasePath}; the CLI never creates one");
        }

        try
        {
            await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
            var info = new FileInfo(runtime.DatabasePath);
            return new DoctorCheck("schema", "ok",
                $"database is readable ({info.Length} bytes) and has the required schema");
        }
        catch (CliException exception) when (exception.Code == "schema_incompatible")
        {
            return new DoctorCheck("schema", "fail", exception.Message);
        }
        catch (CliException exception)
        {
            return new DoctorCheck("database", "fail", exception.Message);
        }
        catch (SqliteException exception)
        {
            return new DoctorCheck("database", "fail", $"the database cannot be read: {exception.Message}");
        }
    }
}

internal sealed record DoctorCheck(string Name, string Status, string Detail);
