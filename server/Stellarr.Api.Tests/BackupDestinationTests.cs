using System.Globalization;
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


    [Fact]
    public async Task WorkerUploadStreamsThroughTheRelayAndVerifiesRemoteMetadata()
    {
        var path = Path.Combine(Path.GetTempPath(), $"backup-{Guid.NewGuid():N}.zip");
        await File.WriteAllTextAsync(path, "archive content");
        try
        {
            using var relay = new RecordingRelay();
            var serverId = Guid.NewGuid();
            var destination = new R2BackupDestination(Options.Create(new CloudflareR2Options
            {
                Enabled = true, Mode = CloudflareR2Modes.Worker, Endpoint = "https://relay.invalid/",
                Prefix = "stellarr", WorkerToken = "relay-token",
            }), _ => throw new InvalidOperationException("S3 is not used in worker mode."), new RelayClientFactory(relay));

            await destination.UploadAsync(path, serverId, default);

            Assert.Equal(1, relay.PutCount);
            Assert.Equal(1, relay.HeadCount);
            Assert.Equal("Bearer relay-token", relay.Authorization);
            Assert.Equal($"stellarr/{serverId:D}/{Path.GetFileName(path)}", relay.Key);
            Assert.Equal(new FileInfo(path).Length, relay.Length);
            Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(path))), relay.Hash);
            Assert.Equal("https://relay.invalid/object", relay.Path);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task WorkerRefusesToOverwriteAConflictingObject()
    {
        var path = Path.Combine(Path.GetTempPath(), $"backup-{Guid.NewGuid():N}.zip");
        await File.WriteAllTextAsync(path, "archive content");
        try
        {
            using var relay = new RecordingRelay { PutStatus = HttpStatusCode.Conflict };
            var destination = new R2BackupDestination(Options.Create(new CloudflareR2Options
            {
                Enabled = true, Mode = CloudflareR2Modes.Worker, Endpoint = "https://relay.invalid",
                Prefix = "stellarr", WorkerToken = "relay-token",
            }), _ => throw new InvalidOperationException("S3 is not used in worker mode."), new RelayClientFactory(relay));

            await Assert.ThrowsAsync<BackupFailedException>(() => destination.UploadAsync(path, Guid.NewGuid(), default));
            Assert.Equal(1, relay.PutCount);
            Assert.Equal(0, relay.HeadCount);
        }
        finally { File.Delete(path); }
    }

    private static R2BackupDestination Create(RecordingS3 client) => new(Options.Create(new CloudflareR2Options
    {
        Enabled = true, Bucket = "private-backups", Endpoint = "https://r2.invalid", AccessKey = "key", SecretKey = "secret",
    }), _ => client);

    private sealed class RelayClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RecordingRelay : HttpMessageHandler
    {
        public HttpStatusCode PutStatus { get; set; } = HttpStatusCode.Created;
        public int PutCount { get; private set; }
        public int HeadCount { get; private set; }
        public string? Authorization { get; private set; }
        public string? Key { get; private set; }
        public string? Path { get; private set; }
        public long Length { get; private set; }
        public string Hash { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Path = request.RequestUri?.AbsoluteUri;
            Authorization = request.Headers.Authorization?.ToString();
            Key = request.Headers.TryGetValues("X-Stellarr-Key", out var keys) ? keys.Single() : null;
            if (request.Method == HttpMethod.Put)
            {
                PutCount++;
                var bytes = await request.Content!.ReadAsByteArrayAsync(cancellationToken);
                Length = bytes.Length;
                Hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
                return new HttpResponseMessage(PutStatus);
            }

            HeadCount++;
            var response = new HttpResponseMessage(HttpStatusCode.OK);
            response.Headers.Add("X-Stellarr-Size", Length.ToString(CultureInfo.InvariantCulture));
            response.Headers.Add("X-Stellarr-Sha256", Hash);
            return response;
        }
    }

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
