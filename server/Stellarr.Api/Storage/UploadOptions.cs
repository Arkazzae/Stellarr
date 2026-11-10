namespace Stellarr.Api.Storage;

/// <summary>Size limits and quotas that apply to uploaded media.</summary>
public sealed class UploadOptions
{
    public const string SectionName = "Uploads";

    public long MaxImageBytes { get; init; } = 10 * 1024 * 1024;
    public long MaxAudioBytes { get; init; } = 25 * 1024 * 1024;
    public long MaxVideoBytes { get; init; } = 100 * 1024 * 1024;
    public long MaxFileBytes { get; init; } = 25 * 1024 * 1024;

    /// <summary>What one account may keep stored. Zero or less disables the quota.</summary>
    public long MaxStoredBytesPerUser { get; init; } = 2L * 1024 * 1024 * 1024;

    /// <summary>What the whole instance may keep stored. Zero or less disables the quota.</summary>
    public long MaxStoredBytes { get; init; } = 20L * 1024 * 1024 * 1024;

    /// <summary>
    /// Free space an upload must leave on the data volume, which the database
    /// and the logs share. Zero turns the check off.
    /// </summary>
    public long MinimumFreeDataRootBytes { get; init; } = 1024L * 1024 * 1024;

    /// <summary>Uploads handled at once, clamped to 1-32.</summary>
    public int MaxConcurrentUploads { get; init; } = 4;
}
