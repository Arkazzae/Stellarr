using System.Diagnostics;
using Stellarr.Api.Data;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Logging;

/// <summary>
/// Takes a sample of the process at start and every <see cref="RuntimeMetrics.Interval"/>
/// after, with a check of the database, so Cockpit can draw how available the
/// instance has been.
/// </summary>
public sealed class RuntimeSampler(
    RuntimeMetrics metrics,
    PresenceTracker presence,
    IServiceScopeFactory scopes,
    TimeProvider time) : BackgroundService
{
    /// <summary>A database check that takes longer than this counts as down.</summary>
    private static readonly TimeSpan DatabaseCheckTimeout = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await SampleAsync(stoppingToken);
        using var timer = new PeriodicTimer(RuntimeMetrics.Interval, time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await SampleAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task SampleAsync(CancellationToken stoppingToken)
    {
        var (up, latency) = await CheckDatabaseAsync(stoppingToken);
        metrics.Sample(time.GetUtcNow().UtcDateTime, presence.ConnectionCount(), up, latency);
    }

    private async Task<(bool Up, double LatencyMs)> CheckDatabaseAsync(CancellationToken stoppingToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        deadline.CancelAfter(DatabaseCheckTimeout);
        var clock = Stopwatch.StartNew();
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var up = await db.Database.CanConnectAsync(deadline.Token);
            return (up, clock.Elapsed.TotalMilliseconds);
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            return (false, clock.Elapsed.TotalMilliseconds);
        }
    }
}
