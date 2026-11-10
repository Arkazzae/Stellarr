using Stellarr.Api.Storage;

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
}
