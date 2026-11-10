namespace Stellarr.Api.Logging;

public static partial class MaintenanceLog
{
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
