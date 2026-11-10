using Microsoft.Extensions.Options;
using Stellarr.Api.Logging;

namespace Stellarr.Api.Maintenance;

/// <summary>
/// Runs <see cref="InstanceMaintenance"/> once after a start-up delay and then
/// at a fixed interval, each time in a scope of its own.
/// </summary>
public sealed class MaintenanceWorker(
    IServiceScopeFactory scopes,
    IOptions<MaintenanceOptions> options,
    TimeProvider time,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            return;
        }

        try
        {
            await Task.Delay(TimeSpan.FromMinutes(Math.Max(0, settings.InitialDelayMinutes)), time, stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromHours(Math.Max(1, settings.IntervalHours)), time);
            do
            {
                await RunOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The host is stopping.
        }
    }

    private async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var result = await scope.ServiceProvider.GetRequiredService<InstanceMaintenance>()
                .RunAsync(time.GetUtcNow().UtcDateTime, cancellationToken);
            // With cleanup switched off every count is zero, and saying that
            // each hour would only suggest that something had been removed.
            if (result.Enabled)
            {
                MaintenanceLog.Completed(
                    logger,
                    result.OrphanAttachments,
                    result.BackupFiles,
                    result.LogFiles,
                    result.PendingObjectDeletions);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException ||
            !cancellationToken.IsCancellationRequested)
        {
            // One failed run must not end the schedule; the next one retries.
            MaintenanceLog.RunFailed(logger, exception);
        }
    }
}
