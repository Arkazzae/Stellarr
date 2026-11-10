using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth;

/// <summary>
/// What a member may do on a server: the privileges of the member's role,
/// narrowed or widened by the overrides set on a section or a channel.
/// </summary>
public static class ServerAccess
{
    /// <summary>Names the server a request is about; without it the caller's first server is used.</summary>
    public const string HeaderName = "X-Stellarr-Server";

    internal const string ContextItemKey = "Stellarr.ActiveServerId";

    private static readonly (ServerPrivileges Privilege, string Name)[] Names =
    [
        (ServerPrivileges.ManageServer, "manageServer"),
        (ServerPrivileges.ManageChannels, "manageChannels"),
        (ServerPrivileges.ManageRoles, "manageRoles"),
        (ServerPrivileges.ManageMembers, "manageMembers"),
        (ServerPrivileges.ManageMessages, "manageMessages"),
        (ServerPrivileges.ModerateMembers, "moderateMembers"),
        (ServerPrivileges.ManageBans, "manageBans"),
        (ServerPrivileges.ViewAuditLog, "viewAuditLog"),
    ];

    private sealed record Membership(Guid RoleId, ServerPrivileges Privileges);

    /// <summary>The wire names of the privileges set in <paramref name="privileges"/>.</summary>
    public static IReadOnlyList<string> ToNames(ServerPrivileges privileges) =>
        Names.Where(x => privileges.HasFlag(x.Privilege)).Select(x => x.Name).ToArray();

    /// <summary>Reads wire names back; false, with nothing granted, when any of them is unknown.</summary>
    public static bool TryParse(IEnumerable<string>? names, out ServerPrivileges privileges)
    {
        var parsed = ServerPrivileges.None;
        foreach (var name in names ?? [])
        {
            var match = Names.FirstOrDefault(x => x.Name == name);
            if (match.Name is null)
            {
                privileges = ServerPrivileges.None;
                return false;
            }

            parsed |= match.Privilege;
        }

        privileges = parsed;
        return true;
    }

    /// <summary>The privileges of the member's role, or none for somebody who is not a member.</summary>
    public static async Task<ServerPrivileges> GetAsync(
        AppDbContext db,
        Guid userId,
        Guid serverId,
        CancellationToken cancellationToken = default) =>
        (await FindMembershipAsync(db, userId, serverId, cancellationToken))?.Privileges ?? ServerPrivileges.None;

    public static async Task<bool> HasAsync(
        AppDbContext db,
        Guid userId,
        Guid serverId,
        ServerPrivileges privilege,
        CancellationToken cancellationToken = default) =>
        (await GetAsync(db, userId, serverId, cancellationToken) & privilege) == privilege;

    /// <summary>
    /// The same question as above, answered for one channel. The override of
    /// the channel's section is applied to the role's privileges first and the
    /// override of the channel itself after it, so the more specific level
    /// has the last word. Within an override a deny beats an allow. A channel
    /// that is not on this server never grants anything.
    /// </summary>
    public static async Task<bool> HasAsync(
        AppDbContext db,
        Guid userId,
        Guid serverId,
        Guid channelId,
        ServerPrivileges privilege,
        CancellationToken cancellationToken = default)
    {
        if (await FindMembershipAsync(db, userId, serverId, cancellationToken) is not { } member)
        {
            return false;
        }

        var channel = await db.Channels.AsNoTracking()
            .Where(x => x.Id == channelId && x.ServerId == serverId)
            .Select(x => new { x.SectionId })
            .SingleOrDefaultAsync(cancellationToken);
        if (channel is null)
        {
            return false;
        }

        var effective = member.Privileges;
        if (channel.SectionId is { } sectionId)
        {
            effective = await ApplyOverrideAsync(
                db, effective, PermissionTargetType.Section, sectionId, member.RoleId, cancellationToken);
        }

        effective = await ApplyOverrideAsync(
            db, effective, PermissionTargetType.Channel, channelId, member.RoleId, cancellationToken);
        return (effective & privilege) == privilege;
    }

    /// <summary>The check for what a role may do to a section, which only that section's override can change.</summary>
    public static async Task<bool> HasForSectionAsync(
        AppDbContext db,
        Guid userId,
        Guid serverId,
        Guid sectionId,
        ServerPrivileges privilege,
        CancellationToken cancellationToken = default)
    {
        if (await FindMembershipAsync(db, userId, serverId, cancellationToken) is not { } member ||
            !await db.Sections.AsNoTracking().AnyAsync(
                x => x.Id == sectionId && x.ServerId == serverId, cancellationToken))
        {
            return false;
        }

        var effective = await ApplyOverrideAsync(
            db, member.Privileges, PermissionTargetType.Section, sectionId, member.RoleId, cancellationToken);
        return (effective & privilege) == privilege;
    }

    /// <summary>The role people get when they join: the system role below the owner's that ranks last.</summary>
    public static async Task<ServerRole?> FindMemberRoleAsync(
        AppDbContext db,
        Guid serverId,
        CancellationToken cancellationToken = default) =>
        await db.ServerRoles.AsNoTracking()
            .Where(x => x.ServerId == serverId && x.IsSystem && !x.IsOwner)
            .OrderByDescending(x => x.Position)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The server the request is about; only available behind <see cref="ServerMembershipFilter"/>.</summary>
    public static Guid RequireActiveServerId(this HttpContext context) =>
        context.Items.TryGetValue(ContextItemKey, out var value) && value is Guid serverId
            ? serverId
            : throw new InvalidOperationException(
                "The active server is unavailable before ServerMembershipFilter runs.");

    private static async Task<Membership?> FindMembershipAsync(
        AppDbContext db,
        Guid userId,
        Guid serverId,
        CancellationToken cancellationToken) =>
        await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == serverId && x.UserId == userId)
            .Select(x => new Membership(x.RoleId, x.Role.Permissions))
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<ServerPrivileges> ApplyOverrideAsync(
        AppDbContext db,
        ServerPrivileges privileges,
        PermissionTargetType targetType,
        Guid targetId,
        Guid roleId,
        CancellationToken cancellationToken)
    {
        var masks = await db.PermissionOverrides.AsNoTracking()
            .Where(x => x.TargetType == targetType && x.TargetId == targetId && x.RoleId == roleId)
            .Select(x => new { x.AllowMask, x.DenyMask })
            .SingleOrDefaultAsync(cancellationToken);
        return masks is null ? privileges : (privileges | masks.AllowMask) & ~masks.DenyMask;
    }
}
