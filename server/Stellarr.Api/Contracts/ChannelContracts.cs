using Stellarr.Api.Auth;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record CreateChannelRequest(string? Name, string? Kind, Guid? SectionId = null);

/// <summary>Every field is optional; a field left out keeps its value.</summary>
public sealed record UpdateChannelRequest(
    string? Name,
    string? Topic,
    int? SlowModeSeconds,
    int? HideAfterInactivityHours,
    string? AudioProfile,
    int? UserLimit);

public sealed record ReorderChannelsRequest(IReadOnlyList<Guid> ChannelIds);

public sealed record CreateSectionRequest(string? Name);

public sealed record UpdateSectionRequest(string? Name);

public sealed record ReorderSectionsRequest(IReadOnlyList<Guid> SectionIds);

/// <summary>A null <c>SectionId</c> takes the channel out of its section.</summary>
public sealed record AssignChannelSectionRequest(Guid? SectionId);

/// <summary>What one role is allowed and denied on top of its own permissions, in wire names.</summary>
public sealed record PermissionOverrideDto(
    string RoleId,
    IReadOnlyList<string> Allow,
    IReadOnlyList<string> Deny);

/// <summary>Both lists empty clears the override.</summary>
public sealed record SetPermissionOverrideRequest(IReadOnlyList<string>? Allow, IReadOnlyList<string>? Deny);

public static class PermissionOverrideContractMappings
{
    public static PermissionOverrideDto ToDto(this PermissionOverride permissionOverride) => new(
        permissionOverride.RoleId.ToString(),
        ServerAccess.ToNames(permissionOverride.AllowMask),
        ServerAccess.ToNames(permissionOverride.DenyMask));
}
