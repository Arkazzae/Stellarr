using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Logging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

// How the process is doing, what it logged and who did what.
public static partial class OpsEndpoints
{
    private const int DefaultLogLimit = 500;
    private const int MaxLogLimit = OpsLogBuffer.Capacity;

    private static async Task<IResult> GetRuntimeAsync(
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        IConfiguration configuration,
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
        var startedAt = process.StartTime.ToUniversalTime();
        var maintenance = configuration.GetValue("Maintenance:Enabled", true);
        var storageInactive = configuration.GetValue<bool>("Storage:SkipInitialization");
        OpsRuntimeServiceDto[] services =
        [
            new("API", "healthy", $".NET {Environment.Version}"),
            new(
                "SQLite",
                databaseReady ? "healthy" : "error",
                databaseReady ? "Połączenie i zapytanie kontrolne działają." : "Baza nie odpowiada."),
            new("SignalR", "healthy", $"{realtimeConnections} aktywnych połączeń"),
            new(
                "Maintenance worker",
                maintenance ? "healthy" : "inactive",
                maintenance ? "Retencja jest uruchomiona." : "Wyłączony w konfiguracji."),
            new(
                "Object storage",
                storageInactive ? "inactive" : "healthy",
                storageInactive ? "Inicjalizacja wyłączona." : "Bucket został sprawdzony podczas startu."),
        ];

        return Results.Ok(new OpsRuntimeDto(
            startedAt,
            Math.Max(0, (long)(DateTime.UtcNow - startedAt).TotalSeconds),
            process.WorkingSet64,
            GC.GetGCMemoryInfo().HeapSizeBytes,
            process.Threads.Count,
            realtimeConnections,
            presence.ActiveVoiceRoomIds().Count(voiceChannelIds.Contains),
            Math.Round(clock.Elapsed.TotalMilliseconds, 2),
            services));
    }

    private static async Task<IResult> GetLogsAsync(
        int? limit,
        HttpContext http,
        AppDbContext db,
        OpsLogBuffer logBuffer,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        var take = Math.Clamp(limit ?? DefaultLogLimit, 1, MaxLogLimit);
        var audit = await db.ServerAuditEntries.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderByDescending(x => x.CreatedAt)
            .Take(take)
            .Select(x => new OpsAuditEntryDto(x.Id.ToString(), x.Actor.DisplayName, x.Summary, x.CreatedAt))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(new OpsLogsDto(
            logBuffer.Snapshot(take)
                .Select(x => new OpsLogEntryDto(x.At, LevelName(x.Level), x.Category, x.Message, x.TraceId))
                .ToArray(),
            audit));
    }

    /// <summary>The whole buffer as tab-separated text, oldest line first.</summary>
    private static IResult ExportLogs(OpsLogBuffer logBuffer)
    {
        var lines = logBuffer.Snapshot(MaxLogLimit);
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
