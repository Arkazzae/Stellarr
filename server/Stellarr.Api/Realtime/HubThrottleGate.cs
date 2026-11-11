using System.Collections.Concurrent;

namespace Stellarr.Api.Realtime;

/// <summary>
/// A token bucket per connection and policy that every hub connection shares.
/// A hub method reaches a room and the database rather than one client, so a
/// busy or broken connection is capped by the server rather than trusted:
/// every bucket holds at least the burst a real negotiation makes and refills
/// faster than any real client ever needs.
/// </summary>
public sealed class HubThrottleGate(TimeProvider? clock = null)
{
    /// <summary>What a connection may send quickly, and what it may not.</summary>
    public enum Policy
    {
        /// <summary>Voice signalling: SDP and many ICE candidates at once.</summary>
        Signalling,

        /// <summary>Signals forwarded to the media server for one session.</summary>
        MediaSignalling,

        /// <summary>Typing indicators, which live six seconds and say nothing new sooner.</summary>
        Typing,

        /// <summary>Opening media sessions: joins, rejoins and a few replacements.</summary>
        MediaSession,
    }

    // The burst and the refill per second, in the order of the policies.
    // Nine people in a mesh restarting ICE at once send around a hundred and
    // twenty candidates within a few seconds; no real client sustains even a
    // small fraction of the signalling rate afterwards. Typing arrives at
    // human speed at worst. A media session is opened per seat, rejoin and
    // replacement, the replacements of one outage being three at most.
    private static readonly (int Burst, double RefillPerSecond)[] Limits =
    [
        (200, 40),
        (60, 10),
        (10, 1),
        (6, 6.0 / 60.0),
    ];

    // Buckets idle long enough to have refilled are swept once in this many
    // calls, so the table stays as small as the connections sending fast.
    private const int SweepInterval = 256;

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly long _origin = (clock ?? TimeProvider.System).GetTimestamp();
    private readonly ConcurrentDictionary<(string ConnectionId, Policy Policy), Bucket> _buckets = new();
    private int _calls;

    public bool TryAcquire(string connectionId, Policy policy)
    {
        var limit = Limits[(int)policy];
        var bucket = _buckets.GetOrAdd((connectionId, policy), static _ => new Bucket());
        var acquired = bucket.TryAcquire(limit, Elapsed());

        if (Interlocked.Increment(ref _calls) % SweepInterval == 0)
        {
            Sweep();
        }

        return acquired;
    }

    private TimeSpan Elapsed() => _clock.GetElapsedTime(_origin);

    private void Sweep()
    {
        var now = Elapsed();
        foreach (var entry in _buckets)
        {
            // A bucket idle long enough to have refilled is indistinguishable
            // from a new one, so forgetting it changes nothing. A sweep racing
            // an acquire loses at most one call's worth of allowance.
            if (entry.Value.HasRefilledToFull(Limits[(int)entry.Key.Policy], now))
            {
                _buckets.TryRemove(entry);
            }
        }
    }

    private sealed class Bucket
    {
        private double _tokens;
        private TimeSpan _lastRefill;
        private bool _fresh = true;

        public bool TryAcquire((int Burst, double RefillPerSecond) limit, TimeSpan now)
        {
            lock (this)
            {
                if (_fresh)
                {
                    // The first call finds the bucket full whatever the
                    // process uptime: a new connection starts with the whole
                    // burst, not with a refill that started when the server booted.
                    _fresh = false;
                    _tokens = limit.Burst;
                }
                else
                {
                    _tokens = Math.Min(
                        limit.Burst,
                        _tokens + (now - _lastRefill).TotalSeconds * limit.RefillPerSecond);
                }
                _lastRefill = now;

                if (_tokens < 1)
                {
                    return false;
                }

                _tokens -= 1;
                return true;
            }
        }

        public bool HasRefilledToFull((int Burst, double RefillPerSecond) limit, TimeSpan now)
        {
            lock (this)
            {
                return _fresh ||
                    _tokens + (now - _lastRefill).TotalSeconds * limit.RefillPerSecond >= limit.Burst;
            }
        }
    }
}
