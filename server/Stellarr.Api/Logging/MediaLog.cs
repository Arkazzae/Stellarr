namespace Stellarr.Api.Logging;

public static partial class MediaLog
{
    [LoggerMessage(
        EventId = 5001,
        Level = LogLevel.Warning,
        Message = "The media server's control API is unavailable; voice waits until it answers.")]
    public static partial void ControlUnavailable(ILogger logger, Exception exception);

    [LoggerMessage(
        EventId = 5002,
        Level = LogLevel.Information,
        Message = "The media server's control API answers again.")]
    public static partial void ControlAvailable(ILogger logger);

    [LoggerMessage(
        EventId = 5003,
        Level = LogLevel.Information,
        Message = "The media server was reset in epoch {Epoch} at sequence {Seq}.")]
    public static partial void Reset(ILogger logger, string epoch, long seq);

    [LoggerMessage(
        EventId = 5004,
        Level = LogLevel.Warning,
        Message = "The media server runs a new epoch {Epoch}; the media sessions of earlier epochs ended.")]
    public static partial void Restarted(ILogger logger, string epoch);

    [LoggerMessage(
        EventId = 5005,
        Level = LogLevel.Warning,
        Message = "The media server no longer keeps the events after sequence {After}; it is reset and every media session ends.")]
    public static partial void EventsLost(ILogger logger, long after);

    [LoggerMessage(
        EventId = 5006,
        Level = LogLevel.Warning,
        Message = "Opening a media session failed.")]
    public static partial void OpenFailed(ILogger logger, Exception exception);

    [LoggerMessage(
        EventId = 5007,
        Level = LogLevel.Warning,
        Message = "A signal for the media server failed.")]
    public static partial void SignalFailed(ILogger logger, Exception exception);

    [LoggerMessage(
        EventId = 5008,
        Level = LogLevel.Warning,
        Message = "Closing media session {SessionId} failed; it stays queued and is tried again.")]
    public static partial void CloseFailed(ILogger logger, Exception exception, string sessionId);

    [LoggerMessage(
        EventId = 5009,
        Level = LogLevel.Information,
        Message = "Closing media sessions works again.")]
    public static partial void ClosingResumed(ILogger logger);

    [LoggerMessage(
        EventId = 5010,
        Level = LogLevel.Warning,
        Message = "Too many media sessions wait to be closed; media session {SessionId} is no longer tried.")]
    public static partial void CloseDropped(ILogger logger, string sessionId);

    [LoggerMessage(
        EventId = 5011,
        Level = LogLevel.Debug,
        Message = "Delivering {Method} to connection {ConnectionId} failed.")]
    public static partial void DeliveryFailed(ILogger logger, Exception exception, string method, string connectionId);

    [LoggerMessage(
        EventId = 5012,
        Level = LogLevel.Warning,
        Message = "Media event {Seq} of type {Type} and kind {Kind} was ignored.")]
    public static partial void EventIgnored(ILogger logger, long seq, string type, string? kind);

}
