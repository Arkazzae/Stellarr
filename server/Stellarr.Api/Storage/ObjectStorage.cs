namespace Stellarr.Api.Storage;

/// <summary>
/// A byte range as an HTTP <c>Range</c> header describes it: both ends are
/// inclusive, and a null <paramref name="To"/> runs to the end of the object.
/// </summary>
public readonly record struct ByteRange(long From, long? To);

/// <summary>One object's bytes, plus what a response needs to describe them.</summary>
/// <remarks>
/// The store keeps bytes only. What they are, their content type included,
/// is in the row that names the key.
/// </remarks>
/// <param name="Length">Bytes in this response, so the slice rather than the object.</param>
/// <param name="TotalLength">Bytes in the whole object.</param>
/// <param name="Range">The slice that was served, or null when the whole object was.</param>
public sealed record StoredObject(
    Stream Stream,
    long Length,
    long TotalLength,
    ByteRange? Range);

/// <summary>An object as a listing names it.</summary>
public sealed record StoredObjectInfo(string Key, long Size);

/// <summary>No object is stored under the key.</summary>
public sealed class ObjectNotFoundException(string key)
    : Exception($"No object is stored under '{key}'.")
{
    public string Key { get; } = key;
}

/// <summary>The requested range starts at or past the end of the object.</summary>
public sealed class RangeNotSatisfiableException(string key)
    : Exception($"The requested range lies outside the object stored under '{key}'.")
{
    public string Key { get; } = key;
}

public interface IObjectStorage
{
    /// <summary>
    /// Gets the store ready at start-up, creating what it needs; throws while
    /// it cannot be used.
    /// </summary>
    Task PrepareAsync(CancellationToken cancellationToken);

    /// <summary>Stores the rest of <paramref name="data"/> under a key that names no object yet.</summary>
    /// <remarks>The stream stays open; it belongs to the caller.</remarks>
    Task PutAsync(string key, Stream data, CancellationToken cancellationToken);

    /// <summary>Reads an object, or only the requested part of it.</summary>
    /// <remarks>
    /// The range has to reach the storage layer instead of being applied to the
    /// returned stream, which need not be able to seek. Asking ASP.NET to serve
    /// a range from a stream that cannot quietly sends the whole object with a
    /// 200. A browser reads that as "this media is not seekable" and restarts
    /// the file from the beginning on every skip.
    /// </remarks>
    /// <exception cref="ObjectNotFoundException">No object is stored under the key.</exception>
    /// <exception cref="RangeNotSatisfiableException">The range starts at or past the end of the object.</exception>
    Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken);

    /// <summary>Removes an object. A key that names none is already removed, so that is no error.</summary>
    Task DeleteAsync(string key, CancellationToken cancellationToken);

    /// <summary>Every object in the store, so a backup misses none a table forgot.</summary>
    IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Asks the store whether it answers, without changing anything; throws
    /// when it does not. Cockpit's availability bars take one every 30 s.
    /// </summary>
    Task ProbeAsync(CancellationToken cancellationToken);
}
