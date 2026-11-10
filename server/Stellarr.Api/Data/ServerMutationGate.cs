namespace Stellarr.Api.Data;

/// <summary>
/// Lets one change of a server-wide invariant at a time through, in this
/// process. A transfer of ownership frees the owner slot and then assigns it,
/// and the database alone cannot stop two of them from interleaving.
/// </summary>
public sealed class ServerMutationGate : IDisposable
{
    private readonly SemaphoreSlim _semaphore = new(1, 1);

    /// <summary>Waits for the turn; disposing the result gives it up.</summary>
    public async ValueTask<IAsyncDisposable> EnterAsync(CancellationToken cancellationToken)
    {
        await _semaphore.WaitAsync(cancellationToken);
        return new Turn(_semaphore);
    }

    public void Dispose() => _semaphore.Dispose();

    private sealed class Turn(SemaphoreSlim semaphore) : IAsyncDisposable
    {
        public ValueTask DisposeAsync()
        {
            semaphore.Release();
            return ValueTask.CompletedTask;
        }
    }
}
