using System.Security.Cryptography;
using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;
using Microsoft.Extensions.Options;

namespace Stellarr.Api.Backups;

public interface IBackupDestination
{
    Task UploadAsync(string path, Guid serverId, CancellationToken cancellationToken);
}

/// <summary>A separate S3 client, bucket and credentials from the live object store.</summary>
public sealed class BackupDestination : IBackupDestination
{
    private readonly BackupDestinationOptions _settings;
    private readonly Func<BackupDestinationOptions, IAmazonS3> _createClient;
    private readonly BackupPolicyStore? _policies;

    public BackupDestination(IOptions<AutomaticBackupOptions> options, BackupPolicyStore? policies = null) : this(options, CreateClient)
    {
        _policies = policies;
    }

    internal BackupDestination(IOptions<AutomaticBackupOptions> options, Func<BackupDestinationOptions, IAmazonS3> createClient)
    {
        _settings = options.Value.Destination;
        _createClient = createClient;
    }

    private static AmazonS3Client CreateClient(BackupDestinationOptions settings) =>
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
        var settings = _policies is null ? _settings : (await _policies.ResolveAsync(cancellationToken)).Destination;
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
