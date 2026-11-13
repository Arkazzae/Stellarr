using System.Net;
using System.Security.Cryptography;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using Stellarr.Api.Backups;
using Stellarr.Api.Integrations.Cloudflare;

namespace Stellarr.Api.Tests;

public sealed class BackupDestinationTests
{
    [Fact]
    public async Task UploadUsesR2CompatibleFlagsAndVerifiesRemoteMetadata()
    {
        var path = Path.Combine(Path.GetTempPath(), $"backup-{Guid.NewGuid():N}.zip");
        await File.WriteAllTextAsync(path, "archive content");
        try
        {
            using var client = new RecordingS3();
            var serverId = Guid.NewGuid();
            var destination = Create(client);
            await destination.UploadAsync(path, serverId, default);
            Assert.Equal(2, client.HeadCount);
            Assert.Equal(1, client.UploadCount);
            Assert.Equal($"stellarr/{serverId:D}/{Path.GetFileName(path)}", client.Key);
            Assert.Equal("private-backups", client.Bucket);
            Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(path))), client.Hash);
        }
        finally { File.Delete(path); }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ExistingObjectsAreNeverOverwritten(bool matching)
    {
        var path = Path.Combine(Path.GetTempPath(), $"backup-{Guid.NewGuid():N}.zip");
        await File.WriteAllTextAsync(path, "archive content");
        try
        {
            using var client = new RecordingS3
            {
                Exists = true,
                Length = new FileInfo(path).Length,
                Hash = matching ? Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(path))) : "wrong",
            };
            var destination = Create(client);
            if (matching) await destination.UploadAsync(path, Guid.NewGuid(), default);
            else await Assert.ThrowsAsync<BackupFailedException>(() => destination.UploadAsync(path, Guid.NewGuid(), default));
            Assert.Equal(0, client.UploadCount);
        }
        finally { File.Delete(path); }
    }

    private static R2BackupDestination Create(RecordingS3 client) => new(Options.Create(new CloudflareR2Options
    {
        Enabled = true, Bucket = "private-backups", Endpoint = "https://r2.invalid", AccessKey = "key", SecretKey = "secret",
    }), _ => client);

    private sealed class RecordingS3() : AmazonS3Client(new AnonymousAWSCredentials(), new AmazonS3Config
    {
        ServiceURL = "https://r2.invalid", ForcePathStyle = true,
    })
    {
        public bool Exists { get; set; }
        public long Length { get; set; }
        public string Hash { get; set; } = "";
        public int HeadCount { get; private set; }
        public int UploadCount { get; private set; }
        public string? Key { get; private set; }
        public string? Bucket { get; private set; }

        public override Task<GetObjectMetadataResponse> GetObjectMetadataAsync(GetObjectMetadataRequest request,
            CancellationToken cancellationToken = default)
        {
            HeadCount++;
            if (!Exists) throw new AmazonS3Exception("Not found") { StatusCode = HttpStatusCode.NotFound };
            var response = new GetObjectMetadataResponse { ContentLength = Length };
            response.Metadata.Add("x-amz-meta-sha256", Hash);
            return Task.FromResult(response);
        }

        public override Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request,
            CancellationToken cancellationToken = default)
        {
            Assert.True(request.DisablePayloadSigning);
            Assert.True(request.DisableDefaultChecksumValidation);
            UploadCount++;
            Exists = true;
            Key = request.Key;
            Bucket = request.BucketName;
            Hash = request.Metadata["x-amz-meta-sha256"];
            Length = File.Exists(request.FilePath) ? new FileInfo(request.FilePath).Length : request.InputStream.Length;
            return Task.FromResult(new PutObjectResponse { ETag = "test-etag" });
        }
    }
}
