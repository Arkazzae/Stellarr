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

/// <summary>One day of the overview's activity chart; <c>Date</c> is the instance's local date.</summary>
public sealed record OpsActivityDayDto(string Date, int Messages, int NewMembers);

/// <summary>Daily activity, oldest day first and today last, in the named time zone.</summary>
public sealed record OpsActivityDto(string TimeZone, IReadOnlyList<OpsActivityDayDto> Days);

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

public sealed record OpsRuntimeServiceDto(string Name, string State, string Detail);

public sealed record OpsRuntimeDto(
    DateTime StartedAt,
    long UptimeSeconds,
    long WorkingSetBytes,
    long GcHeapBytes,
    int ThreadCount,
    int RealtimeConnections,
    int VoiceRooms,
    double DatabaseLatencyMs,
    IReadOnlyList<OpsRuntimeServiceDto> Services);

public sealed record OpsLogEntryDto(
    DateTime At,
    string Level,
    string Source,
    string Message,
    string TraceId);

public sealed record OpsAuditEntryDto(
    string Id,
    string Actor,
    string Summary,
    DateTime At);

public sealed record OpsLogsDto(
    IReadOnlyList<OpsLogEntryDto> Logs,
    IReadOnlyList<OpsAuditEntryDto> Audit);

public sealed record OpsBackupDto(
    string Id,
    long SizeBytes,
    DateTime CreatedAt,
    DateTime? VerifiedAt);

public sealed record OpsBackupsDto(
    IReadOnlyList<OpsBackupDto> Backups,
    int RetentionDays);

public sealed record OpsSettingsDto(
    string InstanceName,
    string PublicUrl,
    string TimeZone,
    bool MailingEnabled,
    string MailProvider,
    string MailFromAddress,
    bool ResendApiKeyConfigured,
    bool InviteMailEnabled,
    bool RecoveryMailEnabled,
    bool AlertMailEnabled,
    int BackupRetentionDays,
    int LogRetentionDays,
    int OrphanObjectRetentionDays,
    bool AutomaticCleanupEnabled,
    DateTime UpdatedAt);

public sealed record OpsDesktopReleaseDto(
    string MinimumVersion,
    string RecommendedVersion,
    ClientReleaseDto? Published,
    ClientReleaseDto? AndroidPublished);

public sealed record CreateOpsUserRequest(
    string? Username,
    string? DisplayName,
    string? Email,
    string? Password,
    Guid RoleId);

public sealed record SetOpsUserRoleRequest(Guid RoleId);

public sealed record SetOpsUserStatusRequest(bool Disabled);

public sealed record UpdateOpsSettingsRequest(
    string? InstanceName,
    string? PublicUrl,
    string? TimeZone,
    bool MailingEnabled,
    string? MailFromAddress,
    bool InviteMailEnabled,
    bool RecoveryMailEnabled,
    bool AlertMailEnabled,
    int BackupRetentionDays,
    int LogRetentionDays,
    int OrphanObjectRetentionDays,
    bool AutomaticCleanupEnabled);

public sealed record UpdateOpsDesktopReleaseRequest(string? MinimumVersion, string? RecommendedVersion);

public sealed record TestMailRequest(string? To);

public static class OpsContractMappings
{
    public static OpsSettingsDto ToOpsDto(
        this OperationsSettings settings,
        string instanceName,
        bool resendApiKeyConfigured) => new(
        instanceName,
        settings.PublicUrl,
        settings.TimeZone,
        settings.MailingEnabled,
        "resend",
        settings.MailFromAddress,
        resendApiKeyConfigured,
        settings.InviteMailEnabled,
        settings.RecoveryMailEnabled,
        settings.AlertMailEnabled,
        settings.BackupRetentionDays,
        settings.LogRetentionDays,
        settings.OrphanObjectRetentionDays,
        settings.AutomaticCleanupEnabled,
        settings.UpdatedAt);

    public static OpsRoleDto ToOpsDto(this ServerRole role, int memberCount) => new(
        role.Id.ToString(),
        role.Name,
        role.Color,
        ServerAccess.ToNames(role.Permissions),
        memberCount,
        role.IsSystem,
        role.IsOwner);
}
