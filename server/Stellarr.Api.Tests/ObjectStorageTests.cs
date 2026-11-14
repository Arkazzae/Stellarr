using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.Extensions.Options;
using Stellarr.Api.Storage;
using GetObjectRequest = Amazon.S3.Model.GetObjectRequest;
using GetObjectResponse = Amazon.S3.Model.GetObjectResponse;

namespace Stellarr.Api.Tests;

public sealed class ObjectStorageTests
{
    [Theory]
    [InlineData("bytes 0-99/100", 0, 99, 100)]
    [InlineData("bytes 100-199/4096", 100, 199, 4096)]
    [InlineData("BYTES 5-5/6", 5, 5, 6)]
    public void ReadsTheRangeActuallyServedByS3(
        string contentRange,
        long expectedFrom,
        long expectedTo,
        long expectedTotal)
    {
        Assert.True(S3ObjectStorage.TryParseContentRange(
            contentRange,
            out var range,
            out var total));
        Assert.Equal(new ByteRange(expectedFrom, expectedTo), range);
        Assert.Equal(expectedTotal, total);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("items 0-9/10")]
    [InlineData("bytes 10-9/100")]
    [InlineData("bytes 0-100/100")]
    [InlineData("bytes */100")]
    public void RejectsMalformedContentRanges(string? contentRange)
    {
        Assert.False(S3ObjectStorage.TryParseContentRange(
            contentRange,
            out _,
            out _));
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, typeof(ObjectNotFoundException))]
    [InlineData(HttpStatusCode.RequestedRangeNotSatisfiable, typeof(RangeNotSatisfiableException))]
    [InlineData(HttpStatusCode.InternalServerError, typeof(AmazonS3Exception))]
    public async Task AnS3RefusalBecomesTheErrorEveryStoreRaises(HttpStatusCode status, Type expected)
    {
        var storage = new S3ObjectStorage(
            new RefusingS3(status),
            Options.Create(new StorageOptions { Provider = StorageProvider.S3, Bucket = "uploads" }));

        var error = await Record.ExceptionAsync(
            () => storage.GetAsync("attachments/a.png", new ByteRange(9, null), CancellationToken.None));

        Assert.IsType(expected, error);
    }

    /// <summary>A client whose every read is answered with one status.</summary>
    private sealed class RefusingS3(HttpStatusCode status) : AmazonS3Client(
        new AnonymousAWSCredentials(),
        new AmazonS3Config { ServiceURL = "https://s3.invalid", ForcePathStyle = true })
    {
        public override Task<GetObjectResponse> GetObjectAsync(
            GetObjectRequest request,
            CancellationToken cancellationToken = default) =>
            throw new AmazonS3Exception("The store refused.") { StatusCode = status };
    }
}
