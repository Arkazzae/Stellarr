using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Stellarr.Api.Domain;
using Stellarr.Api.Maintenance;
using Stellarr.Api.Storage;
using static Stellarr.Api.Tests.DataModelSupport;
using Channels = System.Threading.Channels.Channel;

namespace Stellarr.Api.Tests;

public sealed class MaintenanceWorkerTests
{
    private const int CompletedEvent = 3001;
    private const int RunFailedEvent = 3002;
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task ADisabledWorkerFinishesWithoutRunningAnything()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        await QueueObjectAsync(factory, "worker/disabled.bin");
        var logger = new RecordingLogger();
        using var worker = CreateWorker(
            factory,
            new MaintenanceOptions { Enabled = false, InitialDelayMinutes = 0 },
            TimeProvider.System,
            logger);

        await worker.StartAsync(default);
        await worker.ExecuteTask!.WaitAsync(Patience);

        Assert.Equal(["worker/disabled.bin"], await QueuedKeysAsync(factory));
        Assert.False(logger.HasEvents);
    }

    [Fact]
    public async Task AnEnabledWorkerRunsOnceAndStopsCleanlyWhenCancelled()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        const string key = "worker/enabled.bin";
        await QueueObjectAsync(factory, key);
        var logger = new RecordingLogger();
        using var worker = CreateWorker(
            factory,
            new MaintenanceOptions { Enabled = true, InitialDelayMinutes = 0 },
            TimeProvider.System,
            logger);

        await worker.StartAsync(default);
        Assert.Equal(CompletedEvent, await logger.NextEventAsync());

        Assert.Empty(await QueuedKeysAsync(factory));
        Assert.False(Storage(factory).Contains(key));

        await worker.StopAsync(default);
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task RunsAfterTheInitialDelayAndThenAtEveryInterval()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        // The orphan is expired at the provider's clock but would not be at the real one.
        var now = new DateTimeOffset(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);
        var expiredId = Guid.NewGuid();
        var recentId = Guid.NewGuid();
        await using (var scope = factory.OpenScope(out var db))
        {
            var uploader = (await AddUsersAsync(db, 1))[0];
            db.ImageAttachments.AddRange(
                Attachment(expiredId, uploader, now.AddDays(-2)),
                Attachment(recentId, uploader, now.AddHours(-4)));
            await db.SaveChangesAsync();
        }

        await QueueObjectAsync(factory, "worker/first.bin");
        var time = new ManualTimeProvider(now);
        var logger = new RecordingLogger();
        using var worker = CreateWorker(
            factory,
            new MaintenanceOptions { Enabled = true, InitialDelayMinutes = 5, IntervalHours = 3 },
            time,
            logger);

        await worker.StartAsync(default);
        var delay = await time.NextTimerAsync();
        Assert.Equal(TimeSpan.FromMinutes(5), delay.DueTime);
        Assert.Equal(["worker/first.bin"], await QueuedKeysAsync(factory));

        delay.Fire();
        var interval = await time.NextTimerAsync();
        Assert.Equal(CompletedEvent, await logger.NextEventAsync());
        Assert.Equal(TimeSpan.FromHours(3), interval.DueTime);
        Assert.Equal(TimeSpan.FromHours(3), interval.Period);
        Assert.Empty(await QueuedKeysAsync(factory));
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.False(await db.ImageAttachments.AnyAsync(x => x.Id == expiredId));
            Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == recentId));
        }

        await QueueObjectAsync(factory, "worker/second.bin");
        interval.Fire();
        Assert.Equal(CompletedEvent, await logger.NextEventAsync());
        Assert.Empty(await QueuedKeysAsync(factory));

        await worker.StopAsync(default);
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task ASettingBelowItsMinimumIsRaisedToIt()
    {
        using var factory = new StellarrWebApplicationFactory();
        await BootAsync(factory);
        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);
        var logger = new RecordingLogger();
        using var worker = CreateWorker(
            factory,
            new MaintenanceOptions { Enabled = true, InitialDelayMinutes = -3, IntervalHours = 0 },
            time,
            logger);

        await worker.StartAsync(default);

        // No delay timer is requested, so the first timer is the schedule itself.
        var interval = await time.NextTimerAsync();
        Assert.Equal(CompletedEvent, await logger.NextEventAsync());
        Assert.Equal(TimeSpan.FromHours(1), interval.Period);

        await worker.StopAsync(default);
    }

    [Fact]
    public async Task AFailedRunIsLoggedAndTheWorkerKeepsItsSchedule()
    {
        var logger = new RecordingLogger();
        using var worker = new MaintenanceWorker(
            new FailingScopeFactory(),
            Options.Create(new MaintenanceOptions { Enabled = true, InitialDelayMinutes = 0 }),
            TimeProvider.System,
            logger);

        await worker.StartAsync(default);
        Assert.Equal(RunFailedEvent, await logger.NextEventAsync());

        await worker.StopAsync(default);
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }

    private static async Task BootAsync(StellarrWebApplicationFactory factory)
    {
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");
    }

    private static MaintenanceWorker CreateWorker(
        StellarrWebApplicationFactory factory,
        MaintenanceOptions options,
        TimeProvider time,
        ILogger<MaintenanceWorker> logger) => new(
            factory.Services.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(options),
            time,
            logger);

    private static FakeObjectStorage Storage(StellarrWebApplicationFactory factory) =>
        (FakeObjectStorage)factory.Services.GetRequiredService<IObjectStorage>();

    private static async Task QueueObjectAsync(StellarrWebApplicationFactory factory, string key)
    {
        await Storage(factory).PutAsync(key, new MemoryStream([1]), "application/octet-stream", default);
        await using var scope = factory.OpenScope(out var db);
        db.ObjectDeletions.Add(new ObjectDeletion { ObjectKey = key, QueuedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
    }

    private static async Task<string[]> QueuedKeysAsync(StellarrWebApplicationFactory factory)
    {
        await using var scope = factory.OpenScope(out var db);
        return await db.ObjectDeletions.OrderBy(x => x.ObjectKey).Select(x => x.ObjectKey).ToArrayAsync();
    }

    private static ImageAttachment Attachment(Guid id, User uploader, DateTimeOffset createdAt)
    {
        var attachment = Upload(uploader);
        attachment.Id = id;
        attachment.CreatedAt = createdAt.UtcDateTime;
        return attachment;
    }

    private sealed class FailingScopeFactory : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => throw new InvalidOperationException("No scope for this run.");
    }

    /// <summary>Hands the ids of the events it receives to the test, in order.</summary>
    private sealed class RecordingLogger : ILogger<MaintenanceWorker>
    {
        private readonly Channel<int> _events = Channels.CreateUnbounded<int>();

        public bool HasEvents => _events.Reader.TryPeek(out _);

        public async Task<int> NextEventAsync() => await _events.Reader.ReadAsync().AsTask().WaitAsync(Patience);

        public bool IsEnabled(LogLevel logLevel) => true;

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) => _events.Writer.TryWrite(eventId.Id);
    }

    /// <summary>A clock whose timers fire only when the test says so.</summary>
    private sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private readonly Channel<ManualTimer> _timers = Channels.CreateUnbounded<ManualTimer>();

        public override DateTimeOffset GetUtcNow() => now;

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(callback, state, dueTime, period);
            _timers.Writer.TryWrite(timer);
            return timer;
        }

        public async Task<ManualTimer> NextTimerAsync() =>
            await _timers.Reader.ReadAsync().AsTask().WaitAsync(Patience);
    }

    private sealed class ManualTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) : ITimer
    {
        public TimeSpan DueTime { get; } = dueTime;
        public TimeSpan Period { get; } = period;

        public void Fire() => callback(state);

        public bool Change(TimeSpan newDueTime, TimeSpan newPeriod) => true;

        public void Dispose()
        {
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
