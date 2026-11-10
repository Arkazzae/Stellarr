namespace Stellarr.Api.Logging;

public static partial class MaintenanceLog
{
    [LoggerMessage(
        EventId = 3001,
        Level = LogLevel.Information,
        Message = "Maintenance removed {Attachments} orphan attachments, {Backups} backup files and {Logs} log files; {PendingObjects} object deletions remain queued.")]
    public static partial void Completed(ILogger logger, int attachments, int backups, int logs, int pendingObjects);

    [LoggerMessage(
        EventId = 3002,
        Level = LogLevel.Warning,
        Message = "Maintenance run failed.")]
    public static partial void RunFailed(ILogger logger, Exception exception);

    [LoggerMessage(
        EventId = 3003,
        Level = LogLevel.Warning,
        Message = "Deleting stored object {ObjectKey} failed; it remains queued for retry.")]
    public static partial void ObjectDeleteFailed(ILogger logger, Exception exception, string objectKey);

    [LoggerMessage(
        EventId = 3004,
        Level = LogLevel.Warning,
        Message = "Deleting expired {Kind} file {Path} failed.")]
    public static partial void FileDeleteFailed(ILogger logger, Exception exception, string kind, string path);
}
