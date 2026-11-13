using System.ComponentModel.DataAnnotations;

namespace Stellarr.Api.Backups;

/// <summary>Deployment defaults, overridden by the policy saved in Cockpit.</summary>
public sealed class AutomaticBackupOptions
{
    public const string SectionName = "Backups";
    public bool Enabled { get; init; }
    [Range(1, 8760)] public int IntervalHours { get; init; } = 24;
    [Range(1, 1440)] public int RetryMinutes { get; init; } = 15;
    [Range(0, 1440)] public int InitialDelayMinutes { get; init; } = 5;
    public BackupDestinationOptions Destination { get; init; } = new();
}

public sealed class BackupDestinationOptions
{
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
