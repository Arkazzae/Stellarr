namespace Stellarr.Api.Integrations.Cloudflare;

/// <summary>
/// Deployment defaults for the optional R2 backup destination. Non-secret
/// values can be overridden in Cockpit; the credentials are instance secrets.
/// </summary>
public sealed class CloudflareR2Options
{
    public const string SectionName = "Cloudflare:R2";

    public bool Enabled { get; init; }
    public string Endpoint { get; init; } = "";
    public string Region { get; init; } = "auto";
    public string Bucket { get; init; } = "";
    public string AccessKey { get; init; } = "";
    public string SecretKey { get; init; } = "";
    public string Prefix { get; init; } = "stellarr";

    internal bool IsValid(bool requireCredentials = true) => !Enabled ||
        (Uri.TryCreate(Endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps &&
         string.IsNullOrEmpty(uri.UserInfo) && !string.IsNullOrWhiteSpace(Bucket) &&
         string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
         !string.IsNullOrWhiteSpace(Region) && (!requireCredentials ||
         (!string.IsNullOrWhiteSpace(AccessKey) && !string.IsNullOrWhiteSpace(SecretKey))) && !string.IsNullOrWhiteSpace(Prefix) &&
         !Prefix.Split('/').Any(segment => segment is "" or "." or ".."));
}
