namespace Stellarr.Api.Maintenance;

/// <summary>Settings of the maintenance worker, bound from <c>Maintenance</c>.</summary>
public sealed class MaintenanceOptions
{
    public const string SectionName = "Maintenance";

    /// <summary>Starts the background worker. A run can still be invoked directly.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How long after start-up the first run waits.</summary>
    public int InitialDelayMinutes { get; set; } = 5;

    /// <summary>The time between two runs, at least one hour.</summary>
    public int IntervalHours { get; set; } = 1;

    /// <summary>How many orphan attachments and queued deletions one run handles, from 1 to 1000.</summary>
    public int BatchSize { get; set; } = 1_000;

    /// <summary>
    /// How long the message journal keeps its entries, from 7 to 365 days. A client
    /// that was offline for longer reloads the channel instead of replaying changes.
    /// </summary>
    public int MessageChangeRetentionDays { get; set; } = 30;
}
