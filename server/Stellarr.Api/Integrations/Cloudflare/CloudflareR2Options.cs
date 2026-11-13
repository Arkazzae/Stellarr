namespace Stellarr.Api.Integrations.Cloudflare;

public static class CloudflareR2Modes
{
    public const string S3 = "s3";
    public const string Worker = "worker";

    public static bool IsKnown(string? mode) => mode is S3 or Worker;
}

/// <summary>
/// Deployment defaults for the optional R2 backup destination. Non-secret
/// values can be overridden in Cockpit; the credentials are instance secrets.
/// </summary>
public sealed class CloudflareR2Options
{
    public const string SectionName = "Cloudflare:R2";

    public bool Enabled { get; init; }
    /// <summary><see cref="CloudflareR2Modes.S3"/> for direct S3 credentials, or a deployed backup relay Worker.</summary>
    public string Mode { get; init; } = CloudflareR2Modes.S3;
    public string Endpoint { get; init; } = "";
    public string Region { get; init; } = "auto";
    public string Bucket { get; init; } = "";
    public string AccessKey { get; init; } = "";
    public string SecretKey { get; init; } = "";
    public string WorkerToken { get; init; } = "";
    public string Prefix { get; init; } = "stellarr";

    internal bool IsValid(bool requireCredentials = true) => !Enabled || Mode switch
    {
        CloudflareR2Modes.S3 =>
            Uri.TryCreate(Endpoint, UriKind.Absolute, out var s3) && s3.Scheme == Uri.UriSchemeHttps &&
            string.IsNullOrEmpty(s3.UserInfo) && string.IsNullOrEmpty(s3.Query) && string.IsNullOrEmpty(s3.Fragment) &&
            !string.IsNullOrWhiteSpace(Bucket) && !string.IsNullOrWhiteSpace(Region) &&
            HasSafePrefix() && (!requireCredentials ||
                (!string.IsNullOrWhiteSpace(AccessKey) && !string.IsNullOrWhiteSpace(SecretKey))),
        CloudflareR2Modes.Worker =>
            Uri.TryCreate(Endpoint, UriKind.Absolute, out var worker) && worker.Scheme == Uri.UriSchemeHttps &&
            string.IsNullOrEmpty(worker.UserInfo) && string.IsNullOrEmpty(worker.Query) && string.IsNullOrEmpty(worker.Fragment) &&
            HasSafePrefix() && (!requireCredentials || !string.IsNullOrWhiteSpace(WorkerToken)),
        _ => false,
    };

    private bool HasSafePrefix() =>
        !string.IsNullOrWhiteSpace(Prefix) &&
        !Prefix.Split('/').Any(segment => segment is "" or "." or "..");
}
