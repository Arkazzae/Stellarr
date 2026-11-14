using System.IO.Enumeration;

namespace Stellarr.Api.Storage;

/// <summary>
/// Keeps every object as a plain file in one folder of the data volume, at
/// the path its key names: the key <c>audio/2026/11/….webm</c> is the file
/// <c>files/audio/2026/11/….webm</c>.
/// </summary>
/// <remarks>
/// <para>
/// A file appears under its key only once it is whole. It is written in
/// <see cref="IncomingFolder"/>, flushed to the disk and then moved into
/// place, and nobody sees a move half done. The move itself is not flushed,
/// so a power cut right after an upload can lose that one file; its row then
/// answers 404, as it would for a file deleted by hand.
/// </para>
/// <para>
/// Every key is minted fresh, so a key that already names a file is a
/// mistake, and the write is refused instead of replacing the file.
/// </para>
/// </remarks>
public sealed class FileSystemObjectStorage : IObjectStorage
{
    /// <summary>The folder of the data volume that holds the files.</summary>
    public const string FolderName = "files";

    /// <summary>
    /// Where files are written before they get their key. It sits inside the
    /// root, so the move that publishes a file never crosses file systems,
    /// and no key may start with it.
    /// </summary>
    internal const string IncomingFolder = ".incoming";

    private const int BufferSize = 81920;

    private readonly string _root;
    private readonly string _incoming;

    public FileSystemObjectStorage(string root)
    {
        _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        _incoming = Path.Combine(_root, IncomingFolder);
    }

    /// <summary>Creates the folders and clears what writes cut short by the last stop left behind.</summary>
    public Task PrepareAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_incoming);
        foreach (var leftover in Directory.EnumerateFiles(_incoming))
        {
            File.Delete(leftover);
        }

        return Task.CompletedTask;
    }

    public async Task PutAsync(string key, Stream data, CancellationToken cancellationToken)
    {
        var path = PathOf(key);
        if (File.Exists(path))
        {
            throw new IOException($"An object is already stored under '{key}'.");
        }

        Directory.CreateDirectory(_incoming);
        var temporary = Path.Combine(_incoming, Guid.NewGuid().ToString("N"));
        try
        {
            await using (var file = new FileStream(temporary, new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Options = FileOptions.Asynchronous,
                BufferSize = BufferSize,
            }))
            {
                await data.CopyToAsync(file, BufferSize, cancellationToken);
                await file.FlushAsync(cancellationToken);
                file.Flush(flushToDisk: true);
            }

            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            // Refuses, rather than replaces, a file another write put there meanwhile.
            File.Move(temporary, path, overwrite: false);
        }
        catch
        {
            TryDelete(temporary);
            throw;
        }
    }

    public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken)
    {
        var path = PathOf(key);
        FileStream file;
        try
        {
            file = new FileStream(path, new FileStreamOptions
            {
                Mode = FileMode.Open,
                Access = FileAccess.Read,
                Share = FileShare.Read | FileShare.Delete,
                Options = FileOptions.Asynchronous | FileOptions.SequentialScan,
                BufferSize = BufferSize,
            });
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            throw new ObjectNotFoundException(key);
        }

        var total = file.Length;
        if (range is not { } wanted)
        {
            return Task.FromResult(new StoredObject(file, total, total, null));
        }

        if (wanted.From >= total)
        {
            file.Dispose();
            throw new RangeNotSatisfiableException(key);
        }

        // The end is clamped to the file, as an S3 store does.
        var to = Math.Min(wanted.To ?? total - 1, total - 1);
        var length = to - wanted.From + 1;
        file.Seek(wanted.From, SeekOrigin.Begin);
        return Task.FromResult(new StoredObject(new Slice(file, length), length, total, new ByteRange(wanted.From, to)));
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        var path = PathOf(key);
        try
        {
            File.Delete(path);
        }
        catch (DirectoryNotFoundException)
        {
            // Its folder is gone, so the file is too.
        }

        return Task.CompletedTask;
    }

    public IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken) =>
        Directory.Exists(_root)
            ? Files(cancellationToken).ToAsyncEnumerable()
            : AsyncEnumerable.Empty<StoredObjectInfo>();

    public Task ProbeAsync(CancellationToken cancellationToken) =>
        Directory.Exists(_root)
            ? Task.CompletedTask
            : Task.FromException(new DirectoryNotFoundException($"The folder {_root} does not exist."));

    /// <summary>
    /// Every file but those still being written, ordered by key as an S3
    /// listing is, so that a backup takes them in a stable order.
    /// </summary>
    private IOrderedEnumerable<StoredObjectInfo> Files(CancellationToken cancellationToken)
    {
        var files = new FileSystemEnumerable<StoredObjectInfo>(
            _root,
            (ref FileSystemEntry entry) =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return new StoredObjectInfo(KeyOf(entry.ToFullPath()), entry.Length);
            },
            // A key may start with a dot, which hides a file from a default enumeration.
            new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = 0 })
        {
            ShouldIncludePredicate = (ref FileSystemEntry entry) => !entry.IsDirectory,
            ShouldRecursePredicate = (ref FileSystemEntry entry) =>
                !string.Equals(entry.ToFullPath(), _incoming, StringComparison.Ordinal),
        };

        return files.OrderBy(file => file.Key, StringComparer.Ordinal);
    }

    private string PathOf(string key)
    {
        if (!ObjectKeys.IsSafe(key) ||
            key == IncomingFolder ||
            key.StartsWith(IncomingFolder + "/", StringComparison.Ordinal))
        {
            throw new ArgumentException($"'{key}' cannot name a stored object.", nameof(key));
        }

        return Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar));
    }

    private string KeyOf(string path) =>
        Path.GetRelativePath(_root, path).Replace(Path.DirectorySeparatorChar, '/');

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // The next start clears the incoming folder.
        }
    }

    /// <summary>The next <paramref name="length"/> bytes of a file, which it owns and closes.</summary>
    private sealed class Slice(FileStream file, long length) : Stream
    {
        private long _remaining = length;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            if (_remaining <= 0)
            {
                return 0;
            }

            var read = file.Read(buffer[..(int)Math.Min(buffer.Length, _remaining)]);
            _remaining -= read;
            return read;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_remaining <= 0)
            {
                return 0;
            }

            var read = await file.ReadAsync(buffer[..(int)Math.Min(buffer.Length, _remaining)], cancellationToken);
            _remaining -= read;
            return read;
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                file.Dispose();
            }

            base.Dispose(disposing);
        }

        public override async ValueTask DisposeAsync()
        {
            await file.DisposeAsync();
            await base.DisposeAsync();
        }
    }
}
