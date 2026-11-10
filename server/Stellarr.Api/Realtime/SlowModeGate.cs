namespace Stellarr.Api.Realtime;

/// <summary>
/// Makes the check of a slow-mode channel and the insert it allows one step,
/// so that two requests of one account cannot both pass the same last-message
/// test. An instance runs a single API process, so one gate in front of the
/// database covers every writer and needs no table of per-channel locks.
/// </summary>
public sealed class SlowModeGate : IDisposable
{
    private readonly SemaphoreSlim _entry = new(1, 1);

    /// <summary>Waits for the gate when <paramref name="required"/>; otherwise returns at once.</summary>
    public async ValueTask<Admission> EnterAsync(bool required, CancellationToken cancellationToken)
    {
        if (!required)
        {
            return default;
        }

        await _entry.WaitAsync(cancellationToken);
        return new Admission(_entry);
    }

    public void Dispose() => _entry.Dispose();

    /// <summary>Holds the gate until disposed. The default value holds nothing.</summary>
    public readonly struct Admission(SemaphoreSlim? entry) : IDisposable
    {
        public void Dispose() => entry?.Release();
    }
}
