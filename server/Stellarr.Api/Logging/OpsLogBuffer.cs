namespace Stellarr.Api.Logging;

public sealed record OpsLogRecord(
    DateTime At,
    LogLevel Level,
    string Category,
    string Message,
    string TraceId);

/// <summary>
/// The most recent log lines, kept in memory for the operator panel. It is a
/// logging provider, so whatever the host logs at information level or above
/// lands here; once the buffer is full each new line pushes out the oldest.
/// </summary>
public sealed class OpsLogBuffer(IHttpContextAccessor httpContextAccessor) : ILoggerProvider
{
    public const int Capacity = 2_000;

    /// <summary>Trace id of a line that was not logged while serving a request.</summary>
    private const string BackgroundTraceId = "background";

    private readonly Lock _gate = new();
    private readonly OpsLogRecord?[] _ring = new OpsLogRecord?[Capacity];
    private long _written;

    public ILogger CreateLogger(string categoryName) => new BufferLogger(this, categoryName);

    public void Dispose()
    {
    }

    /// <summary>The newest lines, newest first. <paramref name="limit"/> is held between 1 and <see cref="Capacity"/>.</summary>
    public IReadOnlyList<OpsLogRecord> Snapshot(int limit)
    {
        lock (_gate)
        {
            var count = (int)Math.Min(Math.Clamp(limit, 1, Capacity), _written);
            var lines = new OpsLogRecord[count];
            for (var age = 0; age < count; age++)
            {
                lines[age] = _ring[(_written - 1 - age) % Capacity]!;
            }

            return lines;
        }
    }

    private void Append(LogLevel level, string category, string message)
    {
        var line = new OpsLogRecord(
            DateTime.UtcNow,
            level,
            category,
            message,
            httpContextAccessor.HttpContext?.TraceIdentifier ?? BackgroundTraceId);
        lock (_gate)
        {
            _ring[_written % Capacity] = line;
            _written++;
        }
    }

    private sealed class BufferLogger(OpsLogBuffer buffer, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel is >= LogLevel.Information and < LogLevel.None;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            var message = formatter(state, exception);
            if (exception is not null)
            {
                message = $"{message} — {exception.GetType().Name}: {exception.Message}";
            }

            buffer.Append(logLevel, category, message);
        }
    }
}
