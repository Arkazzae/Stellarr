using System.Text;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

/// <summary>What every object store promises, checked on each one the tests use.</summary>
public abstract class ObjectStorageContract
{
    protected static byte[] Ten => "0123456789"u8.ToArray();

    protected abstract IObjectStorage Storage { get; }

    [Fact]
    public async Task AnObjectReadsBackAsTheBytesThatWereStored()
    {
        await PutAsync("attachments/2026/11/whole.bin", Ten);

        var stored = await Storage.GetAsync("attachments/2026/11/whole.bin", null, CancellationToken.None);

        Assert.Equal(Ten, await ReadAsync(stored));
        Assert.Equal(10, stored.Length);
        Assert.Equal(10, stored.TotalLength);
        Assert.Null(stored.Range);
    }

    [Theory]
    [InlineData(2L, 5L, 2L, 5L)]
    [InlineData(0L, 0L, 0L, 0L)]
    [InlineData(7L, null, 7L, 9L)]
    [InlineData(7L, 100L, 7L, 9L)]
    public async Task ARangeReadsOnlyItsBytesAndSaysWhichItServed(long from, long? to, long first, long last)
    {
        await PutAsync("ranges/object.bin", Ten);

        var stored = await Storage.GetAsync("ranges/object.bin", new ByteRange(from, to), CancellationToken.None);

        Assert.Equal(Ten[(int)first..((int)last + 1)], await ReadAsync(stored));
        Assert.Equal(last - first + 1, stored.Length);
        Assert.Equal(10, stored.TotalLength);
        Assert.Equal(new ByteRange(first, last), stored.Range);
    }

    [Fact]
    public async Task ARangeThatStartsAtOrPastTheEndIsRefused()
    {
        await PutAsync("ranges/short.bin", Ten);
        await PutAsync("ranges/empty.bin", []);

        await Assert.ThrowsAsync<RangeNotSatisfiableException>(
            () => Storage.GetAsync("ranges/short.bin", new ByteRange(10, null), CancellationToken.None));
        await Assert.ThrowsAsync<RangeNotSatisfiableException>(
            () => Storage.GetAsync("ranges/empty.bin", new ByteRange(0, null), CancellationToken.None));
    }

    [Fact]
    public async Task AKeyThatNamesNothingIsNotFound()
    {
        await PutAsync("present/one.bin", Ten);

        var missing = await Assert.ThrowsAsync<ObjectNotFoundException>(
            () => Storage.GetAsync("present/two.bin", null, CancellationToken.None));
        Assert.Equal("present/two.bin", missing.Key);
        await Assert.ThrowsAsync<ObjectNotFoundException>(
            () => Storage.GetAsync("absent/folder/one.bin", null, CancellationToken.None));
    }

    [Fact]
    public async Task DeletingRemovesTheObjectAndDeletingAgainIsNoError()
    {
        await PutAsync("deleted/one.bin", Ten);

        await Storage.DeleteAsync("deleted/one.bin", CancellationToken.None);
        await Storage.DeleteAsync("deleted/one.bin", CancellationToken.None);
        await Storage.DeleteAsync("never/stored.bin", CancellationToken.None);

        await Assert.ThrowsAsync<ObjectNotFoundException>(
            () => Storage.GetAsync("deleted/one.bin", null, CancellationToken.None));
    }

    [Fact]
    public async Task AKeyThatAlreadyNamesAnObjectIsNotOverwritten()
    {
        await PutAsync("unique/one.bin", Ten);

        await Assert.ThrowsAsync<IOException>(() => PutAsync("unique/one.bin", "other"u8.ToArray()));

        Assert.Equal(Ten, await ReadAsync(await Storage.GetAsync("unique/one.bin", null, CancellationToken.None)));
    }

    [Fact]
    public async Task TheListingNamesEveryObjectByItsKeyAndSizeInKeyOrder()
    {
        await PutAsync("b/2026/11/second.bin", Ten);
        await PutAsync("a/first.bin", [1, 2, 3]);
        await PutAsync("top.bin", []);

        var listed = new List<StoredObjectInfo>();
        await foreach (var item in Storage.ListAsync(CancellationToken.None))
        {
            listed.Add(item);
        }

        StoredObjectInfo[] expected = [new("a/first.bin", 3), new("b/2026/11/second.bin", 10), new("top.bin", 0)];
        Assert.Equal(expected, listed);
    }

    [Fact]
    public async Task StoringLeavesTheCallersStreamOpen()
    {
        using var data = new MemoryStream(Ten);

        await Storage.PutAsync("streams/open.bin", data, CancellationToken.None);

        Assert.True(data.CanRead);
    }

    [Fact]
    public async Task APreparedStoreAnswersTheProbe()
    {
        await Storage.PrepareAsync(CancellationToken.None);

        await Storage.ProbeAsync(CancellationToken.None);
    }

    protected async Task PutAsync(string key, byte[] bytes)
    {
        using var data = new MemoryStream(bytes);
        await Storage.PutAsync(key, data, CancellationToken.None);
    }

    protected static async Task<byte[]> ReadAsync(StoredObject stored)
    {
        await using var body = stored.Stream;
        using var copy = new MemoryStream();
        await body.CopyToAsync(copy);
        return copy.ToArray();
    }
}

public sealed class FakeObjectStorageContractTests : ObjectStorageContract
{
    protected override IObjectStorage Storage { get; } = new FakeObjectStorage();
}

public sealed class FileSystemObjectStorageTests : ObjectStorageContract, IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stellarr-files-{Guid.NewGuid():N}");
    private readonly FileSystemObjectStorage _storage;

    public FileSystemObjectStorageTests() => _storage = new FileSystemObjectStorage(_root);

    protected override IObjectStorage Storage => _storage;

    private string Incoming => Path.Combine(_root, FileSystemObjectStorage.IncomingFolder);

    [Fact]
    public async Task AnObjectIsAPlainFileAtThePathItsKeyNames()
    {
        await PutAsync("audio/2026/11/voice.webm", Encoding.UTF8.GetBytes("opus"));

        Assert.Equal("opus", await File.ReadAllTextAsync(Path.Combine(_root, "audio", "2026", "11", "voice.webm")));
    }

    [Theory]
    [InlineData("")]
    [InlineData("/etc/passwd")]
    [InlineData("../outside")]
    [InlineData("a/../../outside")]
    [InlineData("a/./b")]
    [InlineData("a//b")]
    [InlineData("a\\b")]
    [InlineData(".incoming")]
    [InlineData(".incoming/half-written")]
    public async Task AKeyThatCouldLeaveTheFolderOrReachUnfinishedWritesIsRefused(string key)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => PutAsync(key, [1]));
        await Assert.ThrowsAsync<ArgumentException>(() => Storage.GetAsync(key, null, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => Storage.DeleteAsync(key, CancellationToken.None));
        Assert.False(File.Exists(Path.Combine(Path.GetTempPath(), "outside")));
    }

    [Fact]
    public async Task AWriteThatFailsLeavesNothingBehind()
    {
        await using var failing = new FailingStream();

        await Assert.ThrowsAsync<IOException>(
            () => Storage.PutAsync("failed/upload.bin", failing, CancellationToken.None));

        Assert.False(File.Exists(Path.Combine(_root, "failed", "upload.bin")));
        Assert.Empty(Directory.EnumerateFiles(Incoming));
    }

    [Fact]
    public async Task TheListingSkipsFilesStillBeingWritten()
    {
        await PutAsync("done/one.bin", Ten);
        await File.WriteAllTextAsync(Path.Combine(Incoming, "unfinished"), "half");

        var listed = new List<string>();
        await foreach (var item in Storage.ListAsync(CancellationToken.None))
        {
            listed.Add(item.Key);
        }

        Assert.Equal(["done/one.bin"], listed);
    }

    [Fact]
    public async Task PreparingClearsWhatAnInterruptedWriteLeftBehind()
    {
        Directory.CreateDirectory(Incoming);
        await File.WriteAllTextAsync(Path.Combine(Incoming, "unfinished"), "half");

        await Storage.PrepareAsync(CancellationToken.None);

        Assert.True(Directory.Exists(Incoming));
        Assert.Empty(Directory.EnumerateFiles(Incoming));
    }

    [Fact]
    public async Task AStoreWhoseFolderIsGoneFailsTheProbeAndListsNothing()
    {
        await Storage.PrepareAsync(CancellationToken.None);
        Directory.Delete(_root, recursive: true);

        await Assert.ThrowsAsync<DirectoryNotFoundException>(() => Storage.ProbeAsync(CancellationToken.None));
        await foreach (var _ in Storage.ListAsync(CancellationToken.None))
        {
            Assert.Fail("A missing folder holds no objects.");
        }
    }

    [Fact]
    public async Task AFileDeletedByHandIsNotFound()
    {
        await PutAsync("by-hand/gone.bin", Ten);
        File.Delete(Path.Combine(_root, "by-hand", "gone.bin"));

        await Assert.ThrowsAsync<ObjectNotFoundException>(
            () => Storage.GetAsync("by-hand/gone.bin", null, CancellationToken.None));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    /// <summary>Gives a few bytes and then fails, as a client that drops mid-upload does.</summary>
    private sealed class FailingStream() : MemoryStream(new byte[2 * BytesBeforeFailure])
    {
        private const int BytesBeforeFailure = 4;

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            Position >= BytesBeforeFailure
                ? throw new IOException("The client went away.")
                : base.ReadAsync(buffer[..(int)Math.Min(buffer.Length, BytesBeforeFailure - Position)], cancellationToken);
    }
}

public sealed class ObjectKeysTests
{
    [Theory]
    [InlineData("attachments/a/b.png", true)]
    [InlineData("embeds/2026/11/0f1e.jpg", true)]
    [InlineData("", false)]
    [InlineData("../escape", false)]
    [InlineData("a/../../b", false)]
    [InlineData("a/./b", false)]
    [InlineData("/absolute", false)]
    [InlineData("a//b", false)]
    [InlineData("a/", false)]
    [InlineData("a\\b", false)]
    [InlineData("a\0b", false)]
    public void OnlyKeysThatStayInsideTheFolderTheyAreJoinedToAreSafe(string key, bool safe)
    {
        Assert.Equal(safe, ObjectKeys.IsSafe(key));
    }
}
