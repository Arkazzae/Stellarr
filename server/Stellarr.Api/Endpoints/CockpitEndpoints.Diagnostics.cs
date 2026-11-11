using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Logging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

// How the process is doing, what it logged and who did what.
public static partial class CockpitEndpoints
{
    private const int DefaultLogLimit = 100;
    private const int MaxLogLimit = 500;
    private const int MaxLogSources = 50;

    private static async Task<IResult> GetRuntimeAsync(
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        RuntimeMetrics metrics,
        IConfiguration configuration,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        var memberIds = await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .Select(x => x.UserId)
            .ToArrayAsync(cancellationToken);
        var voiceChannelIds = await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId && x.Kind == ChannelKind.Voice)
            .Select(x => x.Id)
            .ToArrayAsync(cancellationToken);
        var realtimeConnections = memberIds.Sum(id => presence.ConnectionIds(id).Count);

        var clock = Stopwatch.StartNew();
        var databaseReady = await db.Database.CanConnectAsync(cancellationToken);
        clock.Stop();

        using var process = Process.GetCurrentProcess();
        var history = metrics.Samples();
        var startedAt = process.StartTime.ToUniversalTime();
        var maintenance = configuration.GetValue("Maintenance:Enabled", true);
        var storageInactive = configuration.GetValue<bool>("Storage:SkipInitialization");
        CockpitRuntimeServiceDto[] services =
        [
            new("API", "healthy", $".NET {Environment.Version}"),
            new(
                "SQLite",
                databaseReady ? "healthy" : "error",
                messages.Get(databaseReady ? MessageKey.CockpitDatabaseHealthy : MessageKey.CockpitDatabaseDown)),
            new("SignalR", "healthy", messages.Get(MessageKey.CockpitRealtimeConnections, ("count", realtimeConnections))),
            new(
                "Maintenance worker",
                maintenance ? "healthy" : "inactive",
                messages.Get(maintenance ? MessageKey.CockpitMaintenanceRunning : MessageKey.CockpitMaintenanceOff)),
            new(
                "Object storage",
                storageInactive ? "inactive" : "healthy",
                messages.Get(storageInactive ? MessageKey.CockpitStorageInitializationOff : MessageKey.CockpitStorageChecked)),
        ];

        return Results.Ok(new CockpitRuntimeDto(
            startedAt,
            Math.Max(0, (long)(DateTime.UtcNow - startedAt).TotalSeconds),
            process.WorkingSet64,
            GC.GetGCMemoryInfo().HeapSizeBytes,
            process.Threads.Count,
            realtimeConnections,
            presence.ActiveVoiceRoomIds().Count(voiceChannelIds.Contains),
            Math.Round(clock.Elapsed.TotalMilliseconds, 2),
            services,
            history.Count > 0 ? history[^1].CpuPercent : 0,
            (int)RuntimeMetrics.Interval.TotalSeconds,
            history.Select(sample => new CockpitRuntimeSampleDto(
                sample.At,
                sample.WorkingSetBytes,
                sample.GcHeapBytes,
                sample.Threads,
                sample.CpuPercent,
                sample.RealtimeConnections,
                sample.Requests,
                sample.ClientErrors,
                sample.ServerErrors)).ToArray()));
    }

    /// <summary>
    /// A page of the log buffer, newest first, filtered by level (a comma-separated
    /// list of info, warn and error), source and a search in the message, source
    /// and trace id. <paramref name="before"/> is the cursor of the previous page.
    /// </summary>
    private static IResult GetLogs(
        long? before,
        int? limit,
        string? level,
        string? source,
        string? search,
        CockpitLogBuffer logBuffer)
    {
        var filter = LogFilter.From(level, source, search);
        var page = logBuffer.Page(before, Math.Clamp(limit ?? DefaultLogLimit, 1, MaxLogLimit), filter.Matches);
        var all = logBuffer.All();
        var counted = all.Where(filter.MatchesIgnoringLevel).Select(line => LevelName(line.Level)).ToArray();
        var sources = all
            .GroupBy(line => line.Category, StringComparer.Ordinal)
            .Select(group => new CockpitLogSourceDto(group.Key, group.Count()))
            .OrderByDescending(x => x.Count).ThenBy(x => x.Name, StringComparer.Ordinal)
            .Take(MaxLogSources)
            .ToArray();

        return Results.Ok(new CockpitLogsDto(
            page.Lines
                .Select(x => new CockpitLogEntryDto(x.Sequence, x.At, LevelName(x.Level), x.Category, x.Message, x.TraceId))
                .ToArray(),
            page.HasMore ? page.Lines[^1].Sequence : null,
            new CockpitLogLevelCountsDto(
                counted.Count(x => x == "info"),
                counted.Count(x => x == "warn"),
                counted.Count(x => x == "error")),
            sources,
            CockpitLogBuffer.Capacity));
    }

    /// <summary>Every line of the buffer that the filters keep, as tab-separated text, oldest line first.</summary>
    private static IResult ExportLogs(string? level, string? source, string? search, CockpitLogBuffer logBuffer)
    {
        var lines = logBuffer.Page(null, CockpitLogBuffer.Capacity, LogFilter.From(level, source, search).Matches).Lines;
        var export = new StringBuilder("at\tlevel\tsource\ttrace\tmessage\n");
        for (var index = lines.Count - 1; index >= 0; index--)
        {
            var line = lines[index];
            export.Append(line.At.ToString("O", CultureInfo.InvariantCulture)).Append('\t')
                .Append(LevelName(line.Level)).Append('\t')
                .Append(SingleLine(line.Category)).Append('\t')
                .Append(SingleLine(line.TraceId)).Append('\t')
                .Append(SingleLine(line.Message)).Append('\n');
        }

        return Results.File(
            Encoding.UTF8.GetBytes(export.ToString()),
            "text/tab-separated-values; charset=utf-8",
            $"stellarr-logs-{DateTime.UtcNow:yyyyMMdd-HHmmss}.tsv");
    }

    /// <summary>The filters of the logs page; an empty value lets every line through.</summary>
    private readonly record struct LogFilter(IReadOnlySet<string>? Levels, string? Source, string? Search)
    {
        private static readonly string[] KnownLevels = ["info", "warn", "error"];

        public static LogFilter From(string? level, string? source, string? search)
        {
            var levels = (level ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => x.ToLowerInvariant())
                .Where(KnownLevels.Contains)
                .ToHashSet(StringComparer.Ordinal);
            return new LogFilter(
                levels.Count == 0 ? null : levels,
                string.IsNullOrWhiteSpace(source) ? null : source.Trim(),
                string.IsNullOrWhiteSpace(search) ? null : search.Trim());
        }

        public bool Matches(CockpitLogRecord line) =>
            (Levels is null || Levels.Contains(LevelName(line.Level))) && MatchesIgnoringLevel(line);

        public bool MatchesIgnoringLevel(CockpitLogRecord line) =>
            (Source is null || string.Equals(line.Category, Source, StringComparison.Ordinal)) &&
            (Search is null ||
                line.Message.Contains(Search, StringComparison.OrdinalIgnoreCase) ||
                line.Category.Contains(Search, StringComparison.OrdinalIgnoreCase) ||
                line.TraceId.Contains(Search, StringComparison.OrdinalIgnoreCase));
    }

    private static string LevelName(LogLevel level) => level switch
    {
        LogLevel.Warning => "warn",
        LogLevel.Error or LogLevel.Critical => "error",
        _ => "info",
    };

    /// <summary>Keeps a value inside its tab-separated cell and row.</summary>
    private static string SingleLine(string value) =>
        value.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
}
