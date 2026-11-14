namespace Stellarr.Api.Logging;

public static partial class StartupLog
{
    [LoggerMessage(
        EventId = 1001,
        Level = LogLevel.Warning,
        Message = "The object store is not ready yet ({Attempt}/{MaxAttempts}): {ErrorMessage}")]
    public static partial void StorageNotReady(ILogger logger, int attempt, int maxAttempts, string errorMessage);
}
