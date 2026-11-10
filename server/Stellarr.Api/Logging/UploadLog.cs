namespace Stellarr.Api.Logging;

public static partial class UploadLog
{
    [LoggerMessage(
        EventId = 4001,
        Level = LogLevel.Warning,
        Message = "Immediate rollback of stored object {ObjectKey} failed; queuing it for maintenance.")]
    public static partial void RollbackDeleteFailed(ILogger logger, Exception exception, string objectKey);

    [LoggerMessage(
        EventId = 4002,
        Level = LogLevel.Error,
        Message = "Persisting the upload rollback queue failed.")]
    public static partial void RollbackQueueFailed(ILogger logger, Exception exception);

    [LoggerMessage(
        EventId = 4003,
        Level = LogLevel.Debug,
        Message = "Attachment {AttachmentId} became referenced while it was being queued for deletion.")]
    public static partial void AttachmentStillReferenced(ILogger logger, Exception exception, Guid attachmentId);
}
