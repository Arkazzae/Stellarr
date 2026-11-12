using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record MfaMethodDto(
    string Id,
    string Type,
    string Name,
    DateTime CreatedAt,
    DateTime? LastUsedAt,
    string? EmailAddress,
    bool Pending);

public sealed record MfaChallengeDto(
    string Status,
    string ChallengeId,
    string Purpose,
    DateTime ExpiresAt,
    IReadOnlyList<MfaMethodDto> Methods,
    bool TrustedDeviceAvailable,
    bool EmailCodeAvailable,
    int TrustedDeviceDays = 14);

public sealed record MfaVerifyRequest(
    string ChallengeId,
    string? MethodId,
    string? Code,
    bool RememberDevice = false,
    bool UseTrustedDevice = false);

public sealed record MfaEmailCodeRequest(string ChallengeId, string? MethodId);

public sealed record MfaTotpStartRequest(string ChallengeId, string? Name);

public sealed record MfaEnrollmentStartRequest(string? Password = null);

public sealed record MfaTotpConfirmRequest(
    string ChallengeId,
    string MethodId,
    string Code,
    string? Name,
    bool RememberDevice = false);

public sealed record MfaEmailStartRequest(string ChallengeId, string? Name);

public sealed record MfaEmailConfirmRequest(
    string ChallengeId,
    string Code,
    string? Name,
    bool RememberDevice = false);

public sealed record MfaCompleteDto(
    string Status,
    UserDto User,
    IReadOnlyList<string>? RecoveryCodes = null,
    DateTime? TrustedDeviceExpiresAt = null);

public sealed record MfaEnrollmentDto(
    string MethodId,
    string Type,
    string? Secret,
    string? OtpAuthUri);

public sealed record TrustedDeviceDto(
    string Id,
    string Name,
    string Device,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    DateTime? LastUsedAt);

public sealed record SecurityEventDto(
    string Id,
    string Kind,
    string Detail,
    string IpAddress,
    string Device,
    DateTime CreatedAt);

public sealed record AccountSecurityDto(
    string Requirement,
    bool MfaRequired,
    bool FreshMfa,
    string? MfaEvidence,
    DateTime? MfaCompletedAt,
    bool TrustedDeviceAvailable,
    IReadOnlyList<MfaMethodDto> Methods,
    int RemainingRecoveryCodes,
    IReadOnlyList<TrustedDeviceDto> TrustedDevices,
    IReadOnlyList<SecurityEventDto> RecentEvents,
    int FreshMfaWindowSeconds = 300,
    int TrustedDeviceDays = 14,
    bool EmailCodeAvailable = false,
    int EmailResendCooldownSeconds = 45,
    bool SecurityRecoveryRequired = false);

/// <summary>One of the account's signed-in devices, as its owner sees it.</summary>
public sealed record OwnSessionDto(
    string Id,
    string Device,
    string IpAddress,
    DateTime CreatedAt,
    DateTime LastSeenAt,
    DateTime ExpiresAt,
    string PrimarySource,
    string? MfaEvidence,
    bool Current);

public sealed record RegenerateRecoveryCodesRequest(string? Password);

public sealed record RemoveMfaMethodRequest(string? Password);

public sealed record CliRecoveryRedeemRequest(string Credential);

public static class SecurityContractMappings
{
    public static MfaMethodDto ToDto(this MfaMethod method) => new(
        method.Id.ToString(),
        method.Type,
        method.Name,
        method.CreatedAt.AsUtc(),
        method.LastUsedAt.AsUtc(),
        method.Type == MfaMethodTypes.Email ? method.EmailAddress : null,
        method.ConfirmedAt is null);

    public static TrustedDeviceDto ToDto(this TrustedDevice device) => new(
        device.Id.ToString(),
        device.Name,
        device.Device,
        device.CreatedAt.AsUtc(),
        device.ExpiresAt.AsUtc(),
        device.LastUsedAt.AsUtc());

    public static OwnSessionDto ToOwnDto(this UserSession session, bool current) => new(
        session.Id.ToString(),
        session.Device,
        session.IpAddress,
        session.CreatedAt.AsUtc(),
        session.LastSeenAt.AsUtc(),
        session.ExpiresAt.AsUtc(),
        session.PrimarySource,
        session.MfaEvidence,
        current);

    public static SecurityEventDto ToDto(this SecurityEvent securityEvent) => new(
        securityEvent.Id.ToString(),
        securityEvent.Kind,
        securityEvent.Detail,
        securityEvent.IpAddress,
        securityEvent.Device,
        securityEvent.CreatedAt.AsUtc());
}
