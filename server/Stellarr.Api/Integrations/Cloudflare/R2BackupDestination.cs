using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;
using Microsoft.Extensions.Options;
using Stellarr.Api.Backups;

namespace Stellarr.Api.Integrations.Cloudflare;

/// <summary>
/// A private Cloudflare R2 bucket that receives a verified copy of every
/// archive. The bucket is reached either through the S3 API with dedicated
/// credentials, or through the optional backup relay Worker deployed from
/// <c>deploy/cloudflare/backup-relay</c>. Kept outside the backup domain:
/// backups only know the <see cref="IBackupDestination"/> contract.
/// </summary>
public sealed class R2BackupDestination : IBackupDestination
{
    /// <summary>The named HTTP client registered for the relay Worker.</summary>
    public const string WorkerClientName = "cloudflare-backup";

    private readonly CloudflareR2Options _settings;
    private readonly Func<CloudflareR2Options, IAmazonS3> _createClient;
    private readonly CloudflareR2PolicyStore? _policies;
    private readonly IHttpClientFactory? _http;

    public R2BackupDestination(
        IOptions<CloudflareR2Options> options,
        CloudflareR2PolicyStore? policies = null,
        IHttpClientFactory? http = null) : this(options, CreateClient, http)
    {
        _policies = policies;
    }

    internal R2BackupDestination(
        IOptions<CloudflareR2Options> options,
        Func<CloudflareR2Options, IAmazonS3> createClient,
        IHttpClientFactory? http = null)
    {
        _settings = options.Value;
        _createClient = createClient;
        _http = http;
    }

    public bool Enabled => _policies?.Current.Enabled ?? _settings.Enabled;

    private static AmazonS3Client CreateClient(CloudflareR2Options settings) =>
        new(new BasicAWSCredentials(settings.AccessKey, settings.SecretKey), new AmazonS3Config
        {
            ServiceURL = settings.Endpoint,
            AuthenticationRegion = settings.Region,
            ForcePathStyle = true,
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        });

    public async Task UploadAsync(string path, Guid serverId, CancellationToken cancellationToken)
    {
        var settings = _policies is null ? _settings : await _policies.ResolveAsync(cancellationToken);
        if (!settings.Enabled) return;
        if (!settings.IsValid()) throw new BackupFailedException("Backup destination credentials or settings are missing.");

        await using var source = File.OpenRead(path);
        var hash = Convert.ToHexStringLower(await SHA256.HashDataAsync(source, cancellationToken));
        var key = $"{settings.Prefix}/{serverId:D}/{Path.GetFileName(path)}";
        if (settings.Mode == CloudflareR2Modes.Worker)
            await UploadToWorkerAsync(path, key, hash, source.Length, settings, cancellationToken);
        else
            await UploadToS3Async(path, key, hash, source.Length, settings, cancellationToken);
    }

    private async Task UploadToS3Async(string path, string key, string hash, long length,
        CloudflareR2Options settings, CancellationToken cancellationToken)
    {
        using var client = _createClient(settings);
        // A lost upload response must not require overwriting an object under
        // a bucket lock. Identical retries are already complete.
        try
        {
            var existing = await client.GetObjectMetadataAsync(new GetObjectMetadataRequest
            {
                BucketName = settings.Bucket, Key = key,
            }, cancellationToken);
            EnsureMatches(existing, length, hash);
            return;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound) { }

        using var transfer = new TransferUtility(client);
        var request = new TransferUtilityUploadRequest
        {
            BucketName = settings.Bucket,
            Key = key,
            FilePath = path,
            ContentType = "application/zip",
            PartSize = 64 * 1024 * 1024,
            DisablePayloadSigning = true,
            DisableDefaultChecksumValidation = true,
        };
        request.Metadata.Add("sha256", hash);
        await transfer.UploadAsync(request, cancellationToken);
        var uploaded = await client.GetObjectMetadataAsync(new GetObjectMetadataRequest
        {
            BucketName = settings.Bucket,
            Key = key,
        }, cancellationToken);
        EnsureMatches(uploaded, length, hash);
    }

    private async Task UploadToWorkerAsync(string path, string key, string hash, long length,
        CloudflareR2Options settings, CancellationToken cancellationToken)
    {
        var http = _http?.CreateClient(WorkerClientName);
        var owned = http is null;
        http ??= new HttpClient { Timeout = TimeSpan.FromHours(2) };
        try
        {
            using var content = new StreamContent(File.OpenRead(path));
            content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
            content.Headers.ContentLength = length;
            using var upload = new HttpRequestMessage(HttpMethod.Put, WorkerObjectUri(settings.Endpoint))
            {
                Content = content,
            };
            Authorize(upload, settings.WorkerToken, key, hash);
            using var response = await http.SendAsync(upload, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode == HttpStatusCode.Conflict)
                throw new BackupFailedException("The remote backup already exists with different metadata.");
            if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.Created))
                throw new BackupFailedException($"The backup relay refused the upload (HTTP {(int)response.StatusCode}).");

            using var head = new HttpRequestMessage(HttpMethod.Head, WorkerObjectUri(settings.Endpoint));
            Authorize(head, settings.WorkerToken, key, "");
            using var metadata = await http.SendAsync(head, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!metadata.IsSuccessStatusCode)
                throw new BackupFailedException($"The backup relay did not confirm the upload (HTTP {(int)metadata.StatusCode}).");
            EnsureWorkerMatches(metadata, length, hash);
        }
        finally
        {
            if (owned) http.Dispose();
        }
    }

    private static void Authorize(HttpRequestMessage request, string token, string key, string hash)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.TryAddWithoutValidation("X-Stellarr-Key", key);
        if (hash.Length > 0) request.Headers.TryAddWithoutValidation("X-Stellarr-Sha256", hash);
    }

    private static Uri WorkerObjectUri(string endpoint) => new(endpoint.TrimEnd('/') + "/object");

    private static void EnsureWorkerMatches(HttpResponseMessage metadata, long length, string hash)
    {
        var size = metadata.Headers.TryGetValues("X-Stellarr-Size", out var sizes) ? sizes.FirstOrDefault() : null;
        var digest = metadata.Headers.TryGetValues("X-Stellarr-Sha256", out var hashes) ? hashes.FirstOrDefault() : null;
        if (size != length.ToString(CultureInfo.InvariantCulture) || digest != hash)
            throw new BackupFailedException("Remote backup metadata does not match the local archive.");
    }

    private static void EnsureMatches(GetObjectMetadataResponse uploaded, long length, string hash)
    {
        if (uploaded.ContentLength != length || uploaded.Metadata["x-amz-meta-sha256"] != hash)
        {
            throw new BackupFailedException("Remote backup metadata does not match the local archive.");
        }
    }
}
