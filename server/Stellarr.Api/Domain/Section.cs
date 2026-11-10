namespace Stellarr.Api.Domain;

/// <summary>A named, collapsible group of channels in the rail, ordered within its server.</summary>
public sealed class Section
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public required string Name { get; set; }
    public int Position { get; set; }
}

/// <summary>What a <see cref="PermissionOverride"/> narrows: one channel or one section.</summary>
public enum PermissionTargetType
{
    Channel = 0,
    Section = 1,
}

/// <summary>
/// A per-role allow and deny narrowing of <see cref="ServerRole.Permissions"/>
/// for one channel or one section. The most specific level wins: a channel's
/// override beats that of its section, which beats the role's base permissions.
/// Within the level that decides, deny wins over allow.
/// </summary>
public sealed class PermissionOverride
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public PermissionTargetType TargetType { get; set; }

    /// <summary>The channel or section id, as <see cref="TargetType"/> says; not a foreign key.</summary>
    public Guid TargetId { get; set; }

    public Guid RoleId { get; set; }
    public ServerPrivileges AllowMask { get; set; }
    public ServerPrivileges DenyMask { get; set; }
}
