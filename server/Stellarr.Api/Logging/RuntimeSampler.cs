using Stellarr.Api.Realtime;

namespace Stellarr.Api.Logging;

/// <summary>Takes a sample of the process at start and every <see cref="RuntimeMetrics.Interval"/> after.</summary>
public sealed class RuntimeSampler(RuntimeMetrics metrics, PresenceTracker presence, TimeProvider time)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        metrics.Sample(time.GetUtcNow().UtcDateTime, presence.ConnectionCount());
        using var timer = new PeriodicTimer(RuntimeMetrics.Interval, time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                metrics.Sample(time.GetUtcNow().UtcDateTime, presence.ConnectionCount());
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }
}
