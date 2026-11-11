namespace Stellarr.Api.Logging;

/// <summary>One log line. <c>Sequence</c> numbers every line the process has logged, from 0, so it stays a stable cursor.</summary>
public sealed record CockpitLogRecord(
    long Sequence,
    DateTime At,
    LogLevel Level,
    string Category,
    string Message,
    string TraceId);

/// <summary>A page of lines, newest first, and whether older matching lines remain in the buffer.</summary>
public sealed record CockpitLogPage(IReadOnlyList<CockpitLogRecord> Lines, bool HasMore);

/// <summary>
/// The most recent log lines, kept in memory for the operator panel. It is a
/// logging provider, so whatever the host logs at information level or above
/// lands here; once the buffer is full each new line pushes out the oldest.
/// </summary>
public sealed class CockpitLogBuffer(IHttpContextAccessor httpContextAccessor) : ILoggerProvider
{
    public const int Capacity = 10_000;

    /// <summary>Trace id of a line that was not logged while serving a request.</summary>
    private const string BackgroundTraceId = "background";

    private readonly Lock _gate = new();
    private readonly CockpitLogRecord?[] _ring = new CockpitLogRecord?[Capacity];
    private long _written;

    public ILogger CreateLogger(string categoryName) => new BufferLogger(this, categoryName);

    public void Dispose()
    {
    }

    /// <summary>The newest lines, newest first. <paramref name="limit"/> is held between 1 and <see cref="Capacity"/>.</summary>
    public IReadOnlyList<CockpitLogRecord> Snapshot(int limit)
    {
        lock (_gate)
        {
            var count = (int)Math.Min(Math.Clamp(limit, 1, Capacity), _written);
            var lines = new CockpitLogRecord[count];
            for (var age = 0; age < count; age++)
            {
                lines[age] = _ring[(_written - 1 - age) % Capacity]!;
            }

            return lines;
        }
    }

    /// <summary>
    /// Up to <paramref name="limit"/> lines that <paramref name="matches"/> accepts,
    /// newest first, all older than the line numbered <paramref name="before"/>, or
    /// the newest ones when it is null.
    /// </summary>
    public CockpitLogPage Page(long? before, int limit, Func<CockpitLogRecord, bool> matches)
    {
        lock (_gate)
        {
            var oldest = Math.Max(0, _written - Capacity);
            var lines = new List<CockpitLogRecord>(limit);
            for (var sequence = Math.Min(before ?? _written, _written) - 1; sequence >= oldest; sequence--)
            {
                var line = _ring[sequence % Capacity]!;
                if (!matches(line))
                {
                    continue;
                }

                if (lines.Count == limit)
                {
                    return new CockpitLogPage(lines, HasMore: true);
                }

                lines.Add(line);
            }

            return new CockpitLogPage(lines, HasMore: false);
        }
    }

    /// <summary>Every line still in the buffer, newest first, for counting.</summary>
    public IReadOnlyList<CockpitLogRecord> All() => Snapshot(Capacity);

    private void Append(LogLevel level, string category, string message)
    {
        var traceId = httpContextAccessor.HttpContext?.TraceIdentifier ?? BackgroundTraceId;
        var at = DateTime.UtcNow;
        lock (_gate)
        {
            _ring[_written % Capacity] = new CockpitLogRecord(_written, at, level, category, message, traceId);
            _written++;
        }
    }

    private sealed class BufferLogger(CockpitLogBuffer buffer, string category) : ILogger
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
