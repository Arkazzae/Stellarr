using Stellarr.Api.Auth;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record CreateRoleRequest(string? Name, string? Color, IReadOnlyList<string>? Permissions);

/// <summary>Every field is optional; a field left out keeps its value.</summary>
public sealed record UpdateRoleRequest(string? Name, string? Color, IReadOnlyList<string>? Permissions);

public sealed record AssignRoleRequest(Guid RoleId);

public sealed record ServerRoleDto(
    string Id,
    string Name,
    string Color,
    IReadOnlyList<string> Permissions,
    int MemberCount,
    bool IsSystem,
    bool IsOwner);

public sealed record ServerMemberDto(UserDto User, string RoleId, DateTime JoinedAt);

/// <summary>What a client learns when the role of a signed-in member changes.</summary>
public sealed record PermissionsChangedDto(string ServerId, IReadOnlyList<string> Permissions);

public static class RoleContractMappings
{
    public static ServerRoleDto ToDto(this ServerRole role, int memberCount) => new(
        role.Id.ToString(),
        role.Name,
        role.Color,
        ServerAccess.ToNames(role.Permissions),
        memberCount,
        role.IsSystem,
        role.IsOwner);
}
