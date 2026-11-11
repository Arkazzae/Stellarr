using System.Diagnostics;

namespace Stellarr.Api.Logging;

/// <summary>
/// What the process looked like over one sampling interval. Request counts are
/// the responses finished during that interval, not totals.
/// </summary>
public sealed record RuntimeSample(
    DateTime At,
    long WorkingSetBytes,
    long GcHeapBytes,
    int Threads,
    double CpuPercent,
    int RealtimeConnections,
    int Requests,
    int ClientErrors,
    int ServerErrors,
    bool DatabaseUp,
    double DatabaseLatencyMs,
    bool? StorageUp = null);

/// <summary>
/// Counts the responses the API sends and keeps one sample of the process per
/// interval for the last hour, in memory, for Cockpit's runtime page. A restart
/// starts the history afresh.
/// </summary>
public sealed class RuntimeMetrics
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    /// <summary>One hour of samples at <see cref="Interval"/>.</summary>
    public const int Capacity = 120;

    private readonly Lock _gate = new();
    private readonly Queue<RuntimeSample> _samples = new();
    private long _requests;
    private long _clientErrors;
    private long _serverErrors;
    private long _sampledRequests;
    private long _sampledClientErrors;
    private long _sampledServerErrors;
    private TimeSpan? _sampledCpu;
    private DateTime? _sampledAt;

    /// <summary>Records one finished response by its status code.</summary>
    public void CountResponse(int statusCode)
    {
        Interlocked.Increment(ref _requests);
        if (statusCode >= 500)
        {
            Interlocked.Increment(ref _serverErrors);
        }
        else if (statusCode >= 400)
        {
            Interlocked.Increment(ref _clientErrors);
        }
    }

    /// <summary>
    /// Takes a sample of this process at <paramref name="now"/> and keeps it,
    /// dropping the oldest once an hour is kept.
    /// </summary>
    /// <param name="storageUp">Whether the object store answered; null when it is not checked.</param>
    public RuntimeSample Sample(
        DateTime now,
        int realtimeConnections,
        bool databaseUp = true,
        double databaseLatencyMs = 0,
        bool? storageUp = null)
    {
        using var process = Process.GetCurrentProcess();
        var cpu = process.TotalProcessorTime;
        var requests = Interlocked.Read(ref _requests);
        var clientErrors = Interlocked.Read(ref _clientErrors);
        var serverErrors = Interlocked.Read(ref _serverErrors);

        lock (_gate)
        {
            // The first sample measures the CPU from the start of the process.
            var since = _sampledAt ?? process.StartTime.ToUniversalTime();
            var wall = (now - since).TotalSeconds * Environment.ProcessorCount;
            var used = (cpu - (_sampledCpu ?? TimeSpan.Zero)).TotalSeconds;
            var cpuPercent = wall > 0 ? Math.Clamp(used / wall * 100, 0, 100) : 0;

            var sample = new RuntimeSample(
                now,
                process.WorkingSet64,
                GC.GetGCMemoryInfo().HeapSizeBytes,
                process.Threads.Count,
                Math.Round(cpuPercent, 1),
                realtimeConnections,
                (int)(requests - _sampledRequests),
                (int)(clientErrors - _sampledClientErrors),
                (int)(serverErrors - _sampledServerErrors),
                databaseUp,
                Math.Round(databaseLatencyMs, 2),
                storageUp);

            _sampledAt = now;
            _sampledCpu = cpu;
            _sampledRequests = requests;
            _sampledClientErrors = clientErrors;
            _sampledServerErrors = serverErrors;
            _samples.Enqueue(sample);
            while (_samples.Count > Capacity)
            {
                _samples.Dequeue();
            }

            return sample;
        }
    }

    /// <summary>The kept samples, oldest first.</summary>
    public IReadOnlyList<RuntimeSample> Samples()
    {
        lock (_gate)
        {
            return [.. _samples];
        }
    }
}
