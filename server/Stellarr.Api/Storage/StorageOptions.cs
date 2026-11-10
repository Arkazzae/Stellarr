namespace Stellarr.Api.Storage;

/// <summary>Connection settings for the S3-compatible object store.</summary>
public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    public string Endpoint { get; init; } = "http://127.0.0.1:9000";
    public string AccessKey { get; init; } = "stellarr";
    public string SecretKey { get; init; } = "stellarr-development-secret";
    public string Bucket { get; init; } = "stellarr-images";
}
