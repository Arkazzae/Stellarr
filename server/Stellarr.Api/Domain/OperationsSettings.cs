namespace Stellarr.Api.Domain;

/// <summary>
/// The operator's configuration of the instance. Secrets such as the mail
/// provider's key are not stored here: they are in <see cref="InstanceSecret"/>,
/// encrypted, or in the environment.
/// </summary>
public sealed class OperationsSettings
{
    public Guid ServerId { get; set; }
    public string PublicUrl { get; set; } = "";
    public string TimeZone { get; set; } = "UTC";
    public bool MailingEnabled { get; set; }
    public string MailFromAddress { get; set; } = "";

    public const int DefaultSmtpPort = 587;
    public string MailSmtpHost { get; set; } = "";
    public int MailSmtpPort { get; set; } = DefaultSmtpPort;
    public string MailSmtpUsername { get; set; } = "";

    /// <summary>starttls, tls or none.</summary>
    public string MailSmtpSecurity { get; set; } = "starttls";

    /// <summary>Whether Resend replaces SMTP; null when the operator never chose.</summary>
    public bool? MailResendEnabled { get; set; }

    /// <summary>Whether the web client offers GIFs; null when the operator never chose, which means on while a key is set.</summary>
    public bool? GiphyEnabled { get; set; }
    public bool InviteMailEnabled { get; set; } = true;
    public bool RecoveryMailEnabled { get; set; } = true;
    public bool AlertMailEnabled { get; set; }
    public int BackupRetentionDays { get; set; } = 14;
    public int LogRetentionDays { get; set; } = 30;
    public int OrphanObjectRetentionDays { get; set; } = 1;
    public bool AutomaticCleanupEnabled { get; set; } = true;
    public string? DesktopMinimumVersion { get; set; }
    public string? DesktopRecommendedVersion { get; set; }

    // Account-security policy. The defaults keep an existing installation on
    // optional MFA, so nobody is locked out by upgrading.
    public string MfaRequirement { get; set; } = MfaRequirements.Optional;
    public int TrustedDeviceDays { get; set; } = 14;
    public int AuthChallengeMinutes { get; set; } = 5;
    public int EmailCodeMinutes { get; set; } = 8;
    public int EmailCodeCooldownSeconds { get; set; } = 45;
    public int EmailCodeMaxAttempts { get; set; } = 5;
    public int EmailCodeSendsPerHour { get; set; } = 10;
    public int CliRecoveryMinutes { get; set; } = 10;

    public DateTime UpdatedAt { get; set; }

    public StellarrServer Server { get; set; } = null!;
}
