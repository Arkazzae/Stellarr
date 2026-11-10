namespace Stellarr.Api.Data;

/// <summary>
/// Lets one registration at a time decide whether the instance is still empty
/// and commit its account. Until the first server exists the database has no
/// row that could enforce "only one first registration", so the process does.
/// </summary>
public sealed class RegistrationGate : IDisposable
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
