namespace Stellarr.Api.Domain;

/// <summary>
/// One entry in a person's notification inbox. The source columns are a
/// snapshot taken when the notification was delivered, so a later change to
/// where it came from never erases or misattributes it.
/// </summary>
public sealed class UserNotification
{
    /// <summary>The inbox order and paging cursor, assigned by the database on insert.</summary>
    public long Sequence { get; set; }

    /// <summary>The identity clients and endpoints refer to; <see cref="Sequence"/> stays internal.</summary>
    public Guid Id { get; set; }

    public Guid ServerId { get; set; }
    public Guid UserId { get; set; }
    public required string Source { get; set; }
    public required string SourcePackageId { get; set; }
    public required string SourcePackageName { get; set; }
    public required string SourceModuleId { get; set; }
    public required string SourceModuleName { get; set; }
    public required string Title { get; set; }
    public required string Body { get; set; }
    public required string Tone { get; set; }
    public Guid? TargetChannelId { get; set; }
    public string? TargetInviteCode { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }

    public User User { get; set; } = null!;
    public StellarrServer Server { get; set; } = null!;
    public Channel? TargetChannel { get; set; }
}
