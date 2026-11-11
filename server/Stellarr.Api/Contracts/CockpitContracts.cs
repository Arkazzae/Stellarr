using Stellarr.Api.Auth;
using Stellarr.Api.Domain;
using Stellarr.Api.Integrations;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

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
    int MessageCount,
    int ServerCount,
    int PublicServerCount);

/// <summary>
/// One day of the overview's activity chart; <c>Date</c> is the instance's local
/// date. Messages, active users, joins and reactions are the instance server's;
/// uploads and sign-ins are the whole instance's.
/// </summary>
public sealed record CockpitActivityDayDto(
    string Date,
    int Messages,
    int NewMembers,
    int ActiveUsers,
    int Reactions,
    int Uploads,
    int SignIns);

/// <summary>
/// Daily activity, oldest day first and today last, in the named time zone.
/// <c>ActiveUsers</c> counts each person who wrote in the window once, which
/// the daily counts cannot add up to.
/// </summary>
public sealed record CockpitActivityDto(string TimeZone, IReadOnlyList<CockpitActivityDayDto> Days, int ActiveUsers);

public sealed record CockpitServerPersonDto(string Id, string Username, string DisplayName);

/// <summary>A server of the instance as Cockpit lists it; <c>IsInstance</c> marks the one the operator owns.</summary>
public sealed record CockpitServerDto(
    string Id,
    string Name,
    string Description,
    bool IsPublic,
    DateTime CreatedAt,
    bool IsInstance,
    CockpitServerPersonDto? Owner,
    int MemberCount,
    int ChannelCount);

public sealed record CockpitServerMemberDto(string Id, string Username, string DisplayName, bool IsOwner);

public sealed record TransferCockpitServerRequest(Guid UserId);

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

/// <summary>One sampling interval of the process; request counts are for that interval alone.</summary>
public sealed record CockpitRuntimeSampleDto(
    DateTime At,
    long WorkingSetBytes,
    long GcHeapBytes,
    int Threads,
    double CpuPercent,
    int RealtimeConnections,
    int Requests,
    int ClientErrors,
    int ServerErrors,
    bool DatabaseUp,
    double DatabaseLatencyMs);

public sealed record CockpitRuntimeDto(
    DateTime StartedAt,
    long UptimeSeconds,
    long WorkingSetBytes,
    long GcHeapBytes,
    int ThreadCount,
    int RealtimeConnections,
    int VoiceRooms,
    double DatabaseLatencyMs,
    IReadOnlyList<CockpitRuntimeServiceDto> Services,
    double CpuPercent,
    int SampleSeconds,
    IReadOnlyList<CockpitRuntimeSampleDto> History);

/// <summary>One log line; <c>Sequence</c> is its place in everything the process has logged, and the paging cursor.</summary>
public sealed record CockpitLogEntryDto(
    long Sequence,
    DateTime At,
    string Level,
    string Source,
    string Message,
    string TraceId);

/// <summary>How many lines of each level match the source and the search, whatever level is chosen.</summary>
public sealed record CockpitLogLevelCountsDto(int Info, int Warn, int Error);

public sealed record CockpitLogSourceDto(string Name, int Count);

/// <summary>
/// A page of log lines, newest first. <c>NextBefore</c> asks for the page after
/// it and is null when no older line matches. <c>Sources</c> lists the categories
/// in the buffer, the busiest first.
/// </summary>
public sealed record CockpitLogsDto(
    IReadOnlyList<CockpitLogEntryDto> Entries,
    long? NextBefore,
    CockpitLogLevelCountsDto Levels,
    IReadOnlyList<CockpitLogSourceDto> Sources,
    int Capacity);

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
    DateTime UpdatedAt,
    bool ResendEnabled,
    string SmtpHost,
    int SmtpPort,
    string SmtpSecurity,
    string SmtpUsername,
    bool SmtpPasswordConfigured,
    bool MailReady,
    bool GiphyEnabled,
    bool GiphyKeyConfigured);

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
    string? TimeZone,
    bool MailingEnabled,
    string? MailFromAddress,
    bool InviteMailEnabled,
    bool RecoveryMailEnabled,
    bool AlertMailEnabled,
    int BackupRetentionDays,
    int LogRetentionDays,
    int OrphanObjectRetentionDays,
    bool AutomaticCleanupEnabled,
    string? SmtpHost = null,
    int? SmtpPort = null,
    string? SmtpSecurity = null,
    string? SmtpUsername = null,
    bool? ResendEnabled = null,
    bool? GiphyEnabled = null);

/// <summary>
/// Whether a secret is set and where its value comes from: <c>panel</c>,
/// <c>environment</c> or <c>none</c>. The value itself never leaves the server.
/// <c>Variable</c> is what an operator would set in <c>.env</c> instead.
/// </summary>
public sealed record CockpitSecretDto(string Name, bool Configured, string Source, string Variable, DateTime? UpdatedAt);

public sealed record SetCockpitSecretRequest(string? Value);

public sealed record UpdateCockpitDesktopReleaseRequest(string? MinimumVersion, string? RecommendedVersion);

public sealed record TestMailRequest(string? To);

public static class CockpitContractMappings
{
    public static CockpitSettingsDto ToCockpitDto(
        this OperationsSettings settings,
        string instanceName,
        string publicUrl,
        ResolvedSecrets secrets)
    {
        var transport = MailTransports.Resolve(settings, secrets);
        return new(
        instanceName,
        publicUrl,
        settings.TimeZone,
        settings.MailingEnabled,
        MailTransports.NameOf(transport.Provider),
        settings.MailFromAddress,
        secrets.ResendApiKey.IsSet,
        settings.InviteMailEnabled,
        settings.RecoveryMailEnabled,
        settings.AlertMailEnabled,
        settings.BackupRetentionDays,
        settings.LogRetentionDays,
        settings.OrphanObjectRetentionDays,
        settings.AutomaticCleanupEnabled,
        settings.UpdatedAt,
        transport.Provider == MailProvider.Resend,
        settings.MailSmtpHost,
        settings.MailSmtpPort,
        MailTransports.ParseSecurity(settings.MailSmtpSecurity) switch
        {
            SmtpSecurity.Tls => MailTransports.TlsName,
            SmtpSecurity.None => MailTransports.NoneName,
            _ => MailTransports.StartTlsName,
        },
        settings.MailSmtpUsername,
        secrets.SmtpPassword.IsSet,
        transport.Ready,
        GiphyState.Resolve(settings, secrets).Enabled,
        secrets.GiphyApiKey.IsSet);
    }

    public static CockpitRoleDto ToCockpitDto(this ServerRole role, int memberCount) => new(
        role.Id.ToString(),
        role.Name,
        role.Color,
        ServerAccess.ToNames(role.Permissions),
        memberCount,
        role.IsSystem,
        role.IsOwner);
}
