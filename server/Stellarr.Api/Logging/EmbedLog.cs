namespace Stellarr.Api.Logging;

/// <summary>Log messages of link previews. A preview nobody asked for must stay cheap.</summary>
public static partial class EmbedLog
{
    [LoggerMessage(
        EventId = 2001,
        Level = LogLevel.Debug,
        Message = "Unfurling {Url} failed.")]
    public static partial void FetchFailed(ILogger logger, Exception exception, Uri url);

    [LoggerMessage(
        EventId = 2002,
        Level = LogLevel.Debug,
        Message = "Storing the preview image of {Url} failed.")]
    public static partial void ThumbnailFailed(ILogger logger, Exception exception, Uri url);

    [LoggerMessage(
        EventId = 2003,
        Level = LogLevel.Warning,
        Message = "Unfurling message {MessageId} failed.")]
    public static partial void MessageFailed(ILogger logger, Exception exception, Guid messageId);

    [LoggerMessage(
        EventId = 2004,
        Level = LogLevel.Warning,
        Message = "Deleting the stale preview image {ObjectKey} failed; it stays queued for maintenance.")]
    public static partial void ThumbnailDeleteFailed(ILogger logger, Exception exception, string objectKey);
}
