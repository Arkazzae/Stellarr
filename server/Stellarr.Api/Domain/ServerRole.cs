namespace Stellarr.Api.Domain;

[Flags]
public enum ServerPrivileges : long
{
    None = 0,
    ManageServer = 1 << 0,
    ManageChannels = 1 << 1,
    ManageRoles = 1 << 2,
    ManageMembers = 1 << 3,
    ManageMessages = 1 << 4,
    ModerateMembers = 1 << 5,
    ManageBans = 1 << 6,
    ViewAuditLog = 1 << 7,
    All = ManageServer | ManageChannels | ManageRoles | ManageMembers |
        ManageMessages | ModerateMembers | ManageBans | ViewAuditLog,
}

public sealed class ServerRole
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public required string Name { get; set; }
    public required string Color { get; set; }
    public ServerPrivileges Permissions { get; set; }
    public int Position { get; set; }

    /// <summary>System roles cannot be removed; the owner role cannot be edited.</summary>
    public bool IsSystem { get; set; }

    public bool IsOwner { get; set; }
}
