using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed class HubThrottleGateTests
{
    private sealed class FakeClock : TimeProvider
    {
        private TimeSpan _now;

        public void Advance(TimeSpan by) => _now += by;

        public override long TimestampFrequency => TimeSpan.TicksPerSecond;

        public override long GetTimestamp() => _now.Ticks;
    }

    [Fact]
    public void NewConnectionStartsWithTheWholeBurst()
    {
        var clock = new FakeClock();
        var gate = new HubThrottleGate(clock);

        // A connection arriving right after the process booted must not pay
        // for the time since start: a fresh bucket is full, not refilling.
        for (var i = 0; i < 10; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }

        Assert.False(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
    }

    [Fact]
    public void BucketRefillsAtItsPoliciesRate()
    {
        var clock = new FakeClock();
        var gate = new HubThrottleGate(clock);

        for (var i = 0; i < 10; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }

        clock.Advance(TimeSpan.FromSeconds(3));
        for (var i = 0; i < 3; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }

        Assert.False(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
    }

    [Fact]
    public void RefillStopsAtTheBurst()
    {
        var clock = new FakeClock();
        var gate = new HubThrottleGate(clock);

        Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        clock.Advance(TimeSpan.FromMinutes(30));
        for (var i = 0; i < 10; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }

        Assert.False(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
    }

    [Fact]
    public void BucketsAreIndependentPerConnectionAndPolicy()
    {
        var clock = new FakeClock();
        var gate = new HubThrottleGate(clock);

        for (var i = 0; i < 10; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }

        // The exhausted bucket of one connection does not touch the typing of
        // another, nor the far larger signalling budget of the same one.
        Assert.True(gate.TryAcquire("c-2", HubThrottleGate.Policy.Typing));
        for (var i = 0; i < 200; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Signalling));
        }

        Assert.False(gate.TryAcquire("c-1", HubThrottleGate.Policy.Signalling));
    }

    [Fact]
    public void SweptBucketsReturnToFull()
    {
        var clock = new FakeClock();
        var gate = new HubThrottleGate(clock);

        for (var i = 0; i < 10; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }

        // Sweeping runs once in its interval of calls, and only forgets
        // buckets idle long enough to have refilled anyway.
        clock.Advance(TimeSpan.FromMinutes(1));
        for (var i = 0; i < 256; i++)
        {
            gate.TryAcquire("c-sweeper", HubThrottleGate.Policy.MediaSession);
        }

        for (var i = 0; i < 10; i++)
        {
            Assert.True(gate.TryAcquire("c-1", HubThrottleGate.Policy.Typing));
        }
    }
}
