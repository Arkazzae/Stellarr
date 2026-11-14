namespace Stellarr.Api.Storage;

/// <summary>Where uploads are kept.</summary>
public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>
    /// Files on the data volume, unless an S3-compatible store is named here;
    /// the settings below are that store's.
    /// </summary>
    public StorageProvider Provider { get; init; } = StorageProvider.FileSystem;

    public string Endpoint { get; init; } = "";
    public string AccessKey { get; init; } = "";
    public string SecretKey { get; init; } = "";
    public string Bucket { get; init; } = "";
}

public enum StorageProvider
{
    /// <summary>Plain files in <c>files/</c> of the data volume.</summary>
    FileSystem,

    /// <summary>One bucket of an S3-compatible store.</summary>
    S3,
}
