using System.Collections.Concurrent;

namespace Stellarr.Api.Realtime;

/// <summary>
/// A cooldown per person and scope that every hub connection shares. Whoever
/// asks first inside the window gets the slot, also when several connections
/// of the same account ask at once.
/// </summary>
public sealed class SoundboardPlaybackGate
{
    // Expired entries are swept once in this many calls, so the table stays
    // as small as the people who played recently.
    private const int SweepInterval = 256;

    private readonly ConcurrentDictionary<(Guid UserId, Guid ScopeId), long> _readyAt = new();
    private int _calls;

    public bool TryAcquire(Guid userId, Guid scopeId, TimeSpan cooldown)
    {
        var now = Environment.TickCount64;
        if (Interlocked.Increment(ref _calls) % SweepInterval == 0)
        {
            Sweep(now);
        }

        var key = (userId, scopeId);
        var next = now + (long)cooldown.TotalMilliseconds;
        while (true)
        {
            if (!_readyAt.TryGetValue(key, out var readyAt))
            {
                if (_readyAt.TryAdd(key, next))
                {
                    return true;
                }
            }
            else if (readyAt > now)
            {
                return false;
            }
            else if (_readyAt.TryUpdate(key, next, readyAt))
            {
                return true;
            }
        }
    }

    private void Sweep(long now)
    {
        foreach (var entry in _readyAt)
        {
            if (entry.Value <= now)
            {
                // Removes only if the value is still the one that was read, so
                // a cooldown renewed meanwhile survives.
                _readyAt.TryRemove(entry);
            }
        }
    }
}
