using System.Globalization;
using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using S3ByteRange = Amazon.S3.Model.ByteRange;

namespace Stellarr.Api.Storage;

/// <summary>Keeps objects in one bucket of an S3-compatible store.</summary>
public sealed class S3ObjectStorage(IAmazonS3 client, IOptions<StorageOptions> options) : IObjectStorage
{
    private const string BytesUnit = "bytes ";
    private readonly string _bucket = options.Value.Bucket;

    public async Task PrepareAsync(CancellationToken cancellationToken)
    {
        var response = await client.ListBucketsAsync(cancellationToken);
        // The SDK leaves empty collections null, and a fresh store answers
        // with an empty listing.
        var exists = response.Buckets?.Any(x => x.BucketName == _bucket) ?? false;
        if (!exists)
        {
            await client.PutBucketAsync(new PutBucketRequest { BucketName = _bucket }, cancellationToken);
        }
    }

    public async Task PutAsync(string key, Stream data, CancellationToken cancellationToken)
    {
        await client.PutObjectAsync(
            new PutObjectRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = data,
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

        GetObjectResponse response;
        try
        {
            response = await client.GetObjectAsync(request, cancellationToken);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            throw new ObjectNotFoundException(key);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
        {
            throw new RangeNotSatisfiableException(key);
        }

        // On a partial response only Content-Range ("bytes 100-199/4096") says
        // how large the whole object is.
        ByteRange? served = null;
        var totalLength = response.ContentLength;
        if (TryParseContentRange(response.ContentRange, out var parsedRange, out var parsedTotal))
        {
            served = parsedRange;
            totalLength = parsedTotal;
        }

        return new StoredObject(response.ResponseStream, response.ContentLength, totalLength, served);
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        client.DeleteObjectAsync(_bucket, key, cancellationToken);

    public Task ProbeAsync(CancellationToken cancellationToken) =>
        client.ListObjectsV2Async(new ListObjectsV2Request { BucketName = _bucket, MaxKeys = 1 }, cancellationToken);

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
