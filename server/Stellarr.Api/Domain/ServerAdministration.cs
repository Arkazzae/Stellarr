namespace Stellarr.Api.Domain;

/// <summary>
/// A persistent refusal of membership on one server. Removing a
/// <see cref="ServerMember"/> is only a kick; this row is what keeps a ban in
/// force across reconnects and restarts until a moderator lifts it.
/// </summary>
public sealed class ServerBan
{
    public Guid ServerId { get; set; }
    public Guid UserId { get; set; }
    public Guid BannedById { get; set; }
    public required string Reason { get; set; }
    public DateTime BannedAt { get; set; }

    public User User { get; set; } = null!;
    public User BannedBy { get; set; } = null!;
}

public sealed class ServerInvite
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public Guid CreatedById { get; set; }

    /// <summary>The channel a new member lands in, or null once that channel is gone.</summary>
    public Guid? ChannelId { get; set; }

    public required string Code { get; set; }
    public int Uses { get; set; }
    public int? MaxUses { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public User CreatedBy { get; set; } = null!;
    public Channel? Channel { get; set; }
}

public sealed class ServerAuditEntry
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public Guid ActorId { get; set; }
    public required string Summary { get; set; }
    public DateTime CreatedAt { get; set; }

    public User Actor { get; set; } = null!;
}
