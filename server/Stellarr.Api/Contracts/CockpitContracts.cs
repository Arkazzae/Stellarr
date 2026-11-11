using Stellarr.Api.Auth;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record CockpitOperatorDto(
    string Id,
    string Username,
    string DisplayName,
    string? AvatarUrl);

public sealed record CockpitInstanceDto(
    string Id,
    string Name,
    DateTime CreatedAt);

public sealed record CockpitOverviewDto(
    int UserCount,
    int OnlineUserCount,
    int RealtimeConnectionCount,
    long StoredObjectBytes,
    int MessageCount);

/// <summary>One day of the overview's activity chart; <c>Date</c> is the instance's local date.</summary>
public sealed record CockpitActivityDayDto(string Date, int Messages, int NewMembers);

/// <summary>Daily activity, oldest day first and today last, in the named time zone.</summary>
public sealed record CockpitActivityDto(string TimeZone, IReadOnlyList<CockpitActivityDayDto> Days);

public sealed record CockpitBootstrapDto(
    CockpitOperatorDto Operator,
    CockpitInstanceDto Instance,
    CockpitOverviewDto Overview);

public sealed record CockpitUserDto(
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

public sealed record CockpitRoleDto(
    string Id,
    string Name,
    string Color,
    IReadOnlyList<string> Permissions,
    int MemberCount,
    bool IsSystem,
    bool IsOwner);

public sealed record CockpitUsersDto(
    IReadOnlyList<CockpitUserDto> Users,
    IReadOnlyList<CockpitRoleDto> Roles,
    bool SessionRegistryAvailable);

public sealed record CockpitSessionDto(
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

public sealed record CockpitRuntimeServiceDto(string Name, string State, string Detail);

public sealed record CockpitRuntimeDto(
    DateTime StartedAt,
    long UptimeSeconds,
    long WorkingSetBytes,
    long GcHeapBytes,
    int ThreadCount,
    int RealtimeConnections,
    int VoiceRooms,
    double DatabaseLatencyMs,
    IReadOnlyList<CockpitRuntimeServiceDto> Services);

public sealed record CockpitLogEntryDto(
    DateTime At,
    string Level,
    string Source,
    string Message,
    string TraceId);

public sealed record CockpitAuditEntryDto(
    string Id,
    string Actor,
    string Summary,
    DateTime At);

public sealed record CockpitLogsDto(
    IReadOnlyList<CockpitLogEntryDto> Logs,
    IReadOnlyList<CockpitAuditEntryDto> Audit);

public sealed record CockpitBackupDto(
    string Id,
    long SizeBytes,
    DateTime CreatedAt,
    DateTime? VerifiedAt);

public sealed record CockpitBackupsDto(
    IReadOnlyList<CockpitBackupDto> Backups,
    int RetentionDays);

public sealed record CockpitSettingsDto(
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

public sealed record CockpitDesktopReleaseDto(
    string MinimumVersion,
    string RecommendedVersion,
    ClientReleaseDto? Published,
    ClientReleaseDto? AndroidPublished);

public sealed record CreateCockpitUserRequest(
    string? Username,
    string? DisplayName,
    string? Email,
    string? Password,
    Guid RoleId);

public sealed record SetCockpitUserRoleRequest(Guid RoleId);

public sealed record SetCockpitUserStatusRequest(bool Disabled);

public sealed record UpdateCockpitSettingsRequest(
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

public sealed record UpdateCockpitDesktopReleaseRequest(string? MinimumVersion, string? RecommendedVersion);

public sealed record TestMailRequest(string? To);

public static class CockpitContractMappings
{
    public static CockpitSettingsDto ToCockpitDto(
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

    public static CockpitRoleDto ToCockpitDto(this ServerRole role, int memberCount) => new(
        role.Id.ToString(),
        role.Name,
        role.Color,
        ServerAccess.ToNames(role.Permissions),
        memberCount,
        role.IsSystem,
        role.IsOwner);
}
