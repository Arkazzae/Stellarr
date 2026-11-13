using System.ComponentModel.DataAnnotations;

namespace Stellarr.Api.Backups;

/// <summary>Deployment defaults for the backup schedule, overridden by the policy saved in Cockpit.</summary>
public sealed class AutomaticBackupOptions
{
    public const string SectionName = "Backups";
    public bool Enabled { get; init; }
    [Range(1, 8760)] public int IntervalHours { get; init; } = 24;
    [Range(1, 1440)] public int RetryMinutes { get; init; } = 15;
    [Range(0, 1440)] public int InitialDelayMinutes { get; init; } = 5;
}
