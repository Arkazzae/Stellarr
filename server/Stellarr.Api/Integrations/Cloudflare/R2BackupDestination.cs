using System.Net;
using System.Security.Cryptography;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;
using Microsoft.Extensions.Options;
using Stellarr.Api.Backups;

namespace Stellarr.Api.Integrations.Cloudflare;

/// <summary>
/// A private Cloudflare R2 bucket (or any S3-compatible store) that receives a
/// verified copy of every archive. Kept outside the backup domain: backups only
/// know the <see cref="IBackupDestination"/> contract.
/// </summary>
public sealed class R2BackupDestination : IBackupDestination
{
    private readonly CloudflareR2Options _settings;
    private readonly Func<CloudflareR2Options, IAmazonS3> _createClient;
    private readonly CloudflareR2PolicyStore? _policies;

    public R2BackupDestination(
        IOptions<CloudflareR2Options> options,
        CloudflareR2PolicyStore? policies = null) : this(options, CreateClient)
    {
        _policies = policies;
    }

    internal R2BackupDestination(
        IOptions<CloudflareR2Options> options,
        Func<CloudflareR2Options, IAmazonS3> createClient)
    {
        _settings = options.Value;
        _createClient = createClient;
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

        using var client = _createClient(settings);
        await using var source = File.OpenRead(path);
        var hash = Convert.ToHexStringLower(await SHA256.HashDataAsync(source, cancellationToken));
        var key = $"{settings.Prefix}/{serverId:D}/{Path.GetFileName(path)}";
        // A lost upload response must not require overwriting an object under
        // a bucket lock. Identical retries are already complete.
        try
        {
            var existing = await client.GetObjectMetadataAsync(new GetObjectMetadataRequest
            {
                BucketName = settings.Bucket, Key = key,
            }, cancellationToken);
            EnsureMatches(existing, source.Length, hash);
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
        EnsureMatches(uploaded, source.Length, hash);
    }

    private static void EnsureMatches(GetObjectMetadataResponse uploaded, long length, string hash)
    {
        if (uploaded.ContentLength != length || uploaded.Metadata["x-amz-meta-sha256"] != hash)
        {
            throw new BackupFailedException("Remote backup metadata does not match the local archive.");
        }
    }
}
