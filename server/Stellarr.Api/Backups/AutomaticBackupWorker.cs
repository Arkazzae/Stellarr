using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;

namespace Stellarr.Api.Backups;

public sealed record AutomaticBackupStatus(
    bool Enabled, int IntervalHours, bool RemoteEnabled,
    DateTime? LastSuccessAt, DateTime? NextAttemptAt, string? PendingBackupId, string? LastError);

internal sealed record AutomaticBackupState(
    DateTime? LastSuccessAt = null, DateTime? NextAttemptAt = null,
    string? PendingBackupId = null, Guid? ServerId = null, string? LastError = null,
    DateTime? LastFailureAt = null);

/// <summary>
/// One instance per data volume. The checkpoint survives restarts; an offsite
/// failure retries the same verified archive rather than producing more copies.
/// </summary>
public sealed partial class AutomaticBackupWorker(
    IServiceScopeFactory scopes,
    IConfiguration configuration,
    IOptions<AutomaticBackupOptions> options,
    BackupJobs jobs,
    IEnumerable<IBackupDestination> destinations,
    TimeProvider time,
    ILogger<AutomaticBackupWorker> logger,
    BackupPolicyStore? policies = null) : BackgroundService
{
    private AutomaticBackupState _state = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string StatePath => Path.Combine(Path.GetFullPath(configuration["DataRoot"] ?? "data"), "automatic-backup.json");

    public AutomaticBackupStatus Status
    {
        get
        {
            var state = Volatile.Read(ref _state);
            var policy = policies?.Current ?? options.Value;
            return new(policy.Enabled, policy.IntervalHours, destinations.Any(x => x.Enabled),
                state.LastSuccessAt, NextAttempt(state, policy), state.PendingBackupId, state.LastError);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            if (File.Exists(StatePath))
            {
                try
                {
                    _state = JsonSerializer.Deserialize<AutomaticBackupState>(await File.ReadAllTextAsync(StatePath, stoppingToken))
                        ?? new();
                }
                catch (Exception exception) when (exception is JsonException or IOException or UnauthorizedAccessException)
                {
                    LogFailure(logger, exception);
                    _state = new(LastError: "The automatic backup checkpoint is unreadable; a new backup will be attempted.");
                }
            }
            var startedAt = time.GetUtcNow();
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), time);
            do
            {
                var policy = policies?.Current ?? options.Value;
                if (time.GetUtcNow() >= startedAt.AddMinutes(policy.InitialDelayMinutes))
                    await RunOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    internal async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        var policy = policies?.Current ?? options.Value;
        if (!policy.Enabled || !await _gate.WaitAsync(0, cancellationToken)) return;
        try
        {
            var now = time.GetUtcNow().UtcDateTime;
            if (NextAttempt(_state, policy) > now || jobs.Running is not null) return;
            var directory = BackupJobs.Directory(configuration);
            if (_state.ServerId is null || _state.PendingBackupId is not { } id || !IsBackupId(id) || !File.Exists(Path.Combine(directory, id)))
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var owner = await db.ServerMembers.AsNoTracking().Where(x => x.OwnerSlot == 1)
                    .Select(x => new { x.ServerId, x.UserId }).FirstOrDefaultAsync(cancellationToken);
                if (owner is null) return; // Setup has not created an instance yet.
                var job = jobs.TryStart(BackupParts.All, owner.ServerId, owner.UserId, automatic: true);
                if (job is null) return;
                if (!await job.Completion.Task.WaitAsync(cancellationToken))
                    throw new BackupFailedException(jobs.LastFailure?.Message ?? "Automatic backup failed.");
                _state = _state with { PendingBackupId = job.Id, ServerId = owner.ServerId };
                await SaveAsync(cancellationToken);
            }

            var path = Path.Combine(directory, _state.PendingBackupId!);
            // Every enabled destination has to accept the archive: a completed
            // local copy alone is not an offsite copy.
            foreach (var destination in destinations.Where(x => x.Enabled))
                await destination.UploadAsync(path, _state.ServerId!.Value, cancellationToken);
            now = time.GetUtcNow().UtcDateTime;
            _state = new(now, now.AddHours(policy.IntervalHours));
            await SaveAsync(cancellationToken);
            LogCompleted(logger, now);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            _state = _state with
            {
                LastError = "Automatic backup failed; inspect the server logs.",
                NextAttemptAt = time.GetUtcNow().UtcDateTime.AddMinutes(policy.RetryMinutes),
                LastFailureAt = time.GetUtcNow().UtcDateTime,
            };
            LogFailure(logger, exception);
            try { await SaveAsync(cancellationToken); }
            catch (Exception saveException) when (saveException is IOException or UnauthorizedAccessException)
            { LogFailure(logger, saveException); }
        }
        finally { _gate.Release(); }
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
        var temporary = StatePath + ".tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(_state), cancellationToken);
        File.Move(temporary, StatePath, overwrite: true);
    }

    private static DateTime? NextAttempt(AutomaticBackupState state, AutomaticBackupOptions policy) =>
        state.LastError is null && state.LastSuccessAt is { } success
            ? success.AddHours(policy.IntervalHours)
            : state.LastFailureAt is { } failure ? failure.AddMinutes(policy.RetryMinutes) : state.NextAttemptAt;

    private static bool IsBackupId(string id) => Path.GetFileName(id) == id &&
        id.StartsWith("backup-", StringComparison.Ordinal) && id.EndsWith(".zip", StringComparison.Ordinal);

    [LoggerMessage(Level = LogLevel.Error, Message = "Automatic backup failed")]
    private static partial void LogFailure(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Information, Message = "Automatic backup completed at {CompletedAt}")]
    private static partial void LogCompleted(ILogger logger, DateTime completedAt);
}
