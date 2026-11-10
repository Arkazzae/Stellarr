using Stellarr.Api.Auth;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record OpsOperatorDto(
    string Id,
    string Username,
    string DisplayName,
    string? AvatarUrl);

public sealed record OpsInstanceDto(
    string Id,
    string Name,
    DateTime CreatedAt);

public sealed record OpsOverviewDto(
    int UserCount,
    int OnlineUserCount,
    int RealtimeConnectionCount,
    long StoredObjectBytes,
    int MessageCount);

public sealed record OpsBootstrapDto(
    OpsOperatorDto Operator,
    OpsInstanceDto Instance,
    OpsOverviewDto Overview);

public sealed record OpsUserDto(
    string Id,
    string Username,
    string DisplayName,
    string? Email,
    string AvatarColor,
    string? AvatarUrl,
    string Presence,
    int RealtimeConnections,
    string RoleId,
    string RoleName,
    bool IsDisabled,
    DateTime JoinedAt,
    DateTime CreatedAt);

public sealed record OpsRoleDto(
    string Id,
    string Name,
    string Color,
    IReadOnlyList<string> Permissions,
    int MemberCount,
    bool IsSystem,
    bool IsOwner);

public sealed record OpsUsersDto(
    IReadOnlyList<OpsUserDto> Users,
    IReadOnlyList<OpsRoleDto> Roles,
    bool SessionRegistryAvailable);

public sealed record OpsSessionDto(
    string Id,
    string UserId,
    string UserDisplayName,
    string Device,
    string? ClientName,
    string? ClientVersion,
    string? ClientRuntime,
    string? InstallType,
    string IpAddress,
    DateTime CreatedAt,
    DateTime LastSeenAt,
    DateTime ExpiresAt,
    bool Current);

public sealed record CreateOpsUserRequest(
    string? Username,
    string? DisplayName,
    string? Email,
    string? Password,
    Guid RoleId);

public sealed record SetOpsUserRoleRequest(Guid RoleId);

public sealed record SetOpsUserStatusRequest(bool Disabled);

public static class OpsContractMappings
{
    public static OpsRoleDto ToOpsDto(this ServerRole role, int memberCount) => new(
        role.Id.ToString(),
        role.Name,
        role.Color,
        ServerAccess.ToNames(role.Permissions),
        memberCount,
        role.IsSystem,
        role.IsOwner);
}
