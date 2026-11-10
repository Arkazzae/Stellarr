namespace Stellarr.Api.Domain;

/// <summary>
/// The operator's configuration of the instance. The mail provider's API key
/// is deliberately not stored here but stays an environment secret, so this
/// row holds only the non-secret delivery settings.
/// </summary>
public sealed class OperationsSettings
{
    public Guid ServerId { get; set; }
    public string PublicUrl { get; set; } = "";
    public string TimeZone { get; set; } = "UTC";
    public bool MailingEnabled { get; set; }
    public string MailFromAddress { get; set; } = "";
    public bool InviteMailEnabled { get; set; } = true;
    public bool RecoveryMailEnabled { get; set; } = true;
    public bool AlertMailEnabled { get; set; }
    public int BackupRetentionDays { get; set; } = 14;
    public int LogRetentionDays { get; set; } = 30;
    public int OrphanObjectRetentionDays { get; set; } = 1;
    public bool AutomaticCleanupEnabled { get; set; } = true;
    public string? DesktopMinimumVersion { get; set; }
    public string? DesktopRecommendedVersion { get; set; }
    public DateTime UpdatedAt { get; set; }

    public StellarrServer Server { get; set; } = null!;
}
