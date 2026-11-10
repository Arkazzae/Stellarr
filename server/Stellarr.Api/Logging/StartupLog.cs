namespace Stellarr.Api.Logging;

public static partial class StartupLog
{
    [LoggerMessage(
        EventId = 1001,
        Level = LogLevel.Warning,
        Message = "RustFS is not ready yet ({Attempt}/{MaxAttempts}): {ErrorMessage}")]
    public static partial void RustFsNotReady(ILogger logger, int attempt, int maxAttempts, string errorMessage);
}
