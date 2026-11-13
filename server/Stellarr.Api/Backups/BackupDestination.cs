namespace Stellarr.Api.Backups;

/// <summary>
/// Somewhere outside this server that a completed archive is copied to. The
/// backup domain knows only this contract; concrete destinations, such as
/// Cloudflare R2, live under Integrations.
/// </summary>
public interface IBackupDestination
{
    /// <summary>Whether this destination should receive the next archive.</summary>
    bool Enabled { get; }

    Task UploadAsync(string path, Guid serverId, CancellationToken cancellationToken);
}
