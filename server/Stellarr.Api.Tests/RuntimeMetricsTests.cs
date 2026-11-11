using Stellarr.Api.Logging;

namespace Stellarr.Api.Tests;

public sealed class RuntimeMetricsTests
{
    private static readonly DateTime Start = new(2026, 11, 11, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void EachSampleCountsTheResponsesSinceThePreviousOne()
    {
        var metrics = new RuntimeMetrics();
        metrics.CountResponse(200);
        metrics.CountResponse(404);
        metrics.Sample(Start, realtimeConnections: 3);

        metrics.CountResponse(201);
        metrics.CountResponse(500);
        metrics.CountResponse(503);
        metrics.CountResponse(429);
        var second = metrics.Sample(Start + RuntimeMetrics.Interval, realtimeConnections: 1);

        var first = metrics.Samples()[0];
        Assert.Equal((2, 1, 0, 3), (first.Requests, first.ClientErrors, first.ServerErrors, first.RealtimeConnections));
        Assert.Equal((4, 1, 2, 1), (second.Requests, second.ClientErrors, second.ServerErrors, second.RealtimeConnections));
    }

    [Fact]
    public void KeepsOneHourAndDropsTheOldest()
    {
        var metrics = new RuntimeMetrics();
        for (var index = 0; index < RuntimeMetrics.Capacity + 5; index++)
        {
            metrics.Sample(Start + (RuntimeMetrics.Interval * index), realtimeConnections: 0);
        }

        var samples = metrics.Samples();
        Assert.Equal(RuntimeMetrics.Capacity, samples.Count);
        Assert.Equal(Start + (RuntimeMetrics.Interval * 5), samples[0].At);
        Assert.Equal(Start + (RuntimeMetrics.Interval * (RuntimeMetrics.Capacity + 4)), samples[^1].At);
    }

    [Fact]
    public void EachSampleKeepsTheDatabaseCheck()
    {
        var metrics = new RuntimeMetrics();

        var down = metrics.Sample(Start, realtimeConnections: 0, databaseUp: false, databaseLatencyMs: 5000.123);

        Assert.Equal((false, 5000.12), (down.DatabaseUp, down.DatabaseLatencyMs));
    }

    [Fact]
    public void ReportsTheProcessAndABoundedCpuShare()
    {
        var metrics = new RuntimeMetrics();

        var sample = metrics.Sample(DateTime.UtcNow, realtimeConnections: 0);

        Assert.True(sample.WorkingSetBytes > 0);
        Assert.True(sample.Threads > 0);
        Assert.InRange(sample.CpuPercent, 0, 100);
    }
}
