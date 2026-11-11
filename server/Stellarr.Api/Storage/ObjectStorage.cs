using System.Globalization;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using S3ByteRange = Amazon.S3.Model.ByteRange;

namespace Stellarr.Api.Storage;

/// <summary>
/// A byte range as an HTTP <c>Range</c> header describes it: both ends are
/// inclusive, and a null <paramref name="To"/> runs to the end of the object.
/// </summary>
public readonly record struct ByteRange(long From, long? To);

/// <summary>One object's bytes, plus what a response needs to describe them.</summary>
/// <param name="Length">Bytes in this response, so the slice rather than the object.</param>
/// <param name="TotalLength">Bytes in the whole object.</param>
/// <param name="Range">The slice that was served, or null when the whole object was.</param>
public sealed record StoredObject(
    Stream Stream,
    string ContentType,
    long Length,
    long TotalLength,
    ByteRange? Range);

/// <summary>An object as a listing names it.</summary>
public sealed record StoredObjectInfo(string Key, long Size);

public interface IObjectStorage
{
    Task EnsureBucketAsync(CancellationToken cancellationToken);

    Task PutAsync(string key, Stream data, string contentType, CancellationToken cancellationToken);

    /// <summary>Reads an object, or only the requested part of it.</summary>
    /// <remarks>
    /// The range has to reach the storage layer instead of being applied to the
    /// returned stream. A response from S3 is a network stream and cannot seek,
    /// so asking ASP.NET to serve a range from it quietly sends the whole object
    /// with a 200. A browser reads that as "this media is not seekable" and
    /// restarts the file from the beginning on every skip.
    /// </remarks>
    Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken);

    Task DeleteAsync(string key, CancellationToken cancellationToken);

    /// <summary>Every object in the bucket, page by page, so a backup misses none a table forgot.</summary>
    IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken);
}

public sealed class S3ObjectStorage(IAmazonS3 client, IOptions<StorageOptions> options) : IObjectStorage
{
    private const string BytesUnit = "bytes ";
    private readonly string _bucket = options.Value.Bucket;

    public async Task EnsureBucketAsync(CancellationToken cancellationToken)
    {
        var response = await client.ListBucketsAsync(cancellationToken);
        // The SDK leaves empty collections null, and a fresh RustFS install
        // answers with an empty listing.
        var exists = response.Buckets?.Any(x => x.BucketName == _bucket) ?? false;
        if (!exists)
        {
            await client.PutBucketAsync(new PutBucketRequest { BucketName = _bucket }, cancellationToken);
        }
    }

    public async Task PutAsync(string key, Stream data, string contentType, CancellationToken cancellationToken)
    {
        await client.PutObjectAsync(
            new PutObjectRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = data,
                ContentType = contentType,
                AutoCloseStream = false,
            },
            cancellationToken);
    }

    public async Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken)
    {
        var request = new GetObjectRequest { BucketName = _bucket, Key = key };
        if (range is { } wanted)
        {
            // S3 treats both ends as inclusive and has no open-ended form, so
            // "to the end" is a request up to the largest possible offset.
            request.ByteRange = new S3ByteRange(wanted.From, wanted.To ?? long.MaxValue);
        }

        var response = await client.GetObjectAsync(request, cancellationToken);

        // On a partial response only Content-Range ("bytes 100-199/4096") says
        // how large the whole object is.
        ByteRange? served = null;
        var totalLength = response.ContentLength;
        if (TryParseContentRange(response.ContentRange, out var parsedRange, out var parsedTotal))
        {
            served = parsedRange;
            totalLength = parsedTotal;
        }

        return new StoredObject(
            response.ResponseStream,
            response.Headers.ContentType ?? "application/octet-stream",
            response.ContentLength,
            totalLength,
            served);
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        client.DeleteObjectAsync(_bucket, key, cancellationToken);

    public async IAsyncEnumerable<StoredObjectInfo> ListAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        string? continuation = null;
        do
        {
            var page = await client.ListObjectsV2Async(
                new ListObjectsV2Request { BucketName = _bucket, ContinuationToken = continuation },
                cancellationToken);
            // The SDK leaves an empty page's collection null.
            foreach (var item in page.S3Objects ?? [])
            {
                yield return new StoredObjectInfo(item.Key, item.Size ?? 0);
            }

            continuation = page.IsTruncated == true ? page.NextContinuationToken : null;
        }
        while (continuation is not null);
    }

    /// <summary>
    /// Reads the <c>bytes from-to/total</c> form. A range outside its object,
    /// or one the server could not size (<c>*</c>), is refused.
    /// </summary>
    internal static bool TryParseContentRange(string? value, out ByteRange range, out long totalLength)
    {
        range = default;
        totalLength = 0;
        if (value is null || !value.StartsWith(BytesUnit, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var payload = value.AsSpan(BytesUnit.Length);
        var dash = payload.IndexOf('-');
        var slash = payload.IndexOf('/');
        if (dash < 1 || slash < dash + 2 ||
            !TryParseOffset(payload[..dash], out var from) ||
            !TryParseOffset(payload[(dash + 1)..slash], out var to) ||
            !TryParseOffset(payload[(slash + 1)..], out var total) ||
            to < from || total <= to)
        {
            return false;
        }

        range = new ByteRange(from, to);
        totalLength = total;
        return true;
    }

    private static bool TryParseOffset(ReadOnlySpan<char> digits, out long offset) =>
        long.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out offset);
}
