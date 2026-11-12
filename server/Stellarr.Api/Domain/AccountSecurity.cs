namespace Stellarr.Api.Domain;

/// <summary>How strongly an instance asks for a second factor after the primary proof.</summary>
public static class MfaRequirements
{
    public const string Optional = "optional";
    public const string Admins = "admins";
    public const string Everyone = "everyone";
    public const string Cockpit = "cockpit";

    public static readonly string[] All = [Optional, Admins, Everyone, Cockpit];

    public static bool IsKnown(string? value) =>
        value is not null && All.Contains(value.Trim().ToLowerInvariant(), StringComparer.Ordinal);

    public static string Normalize(string? value) =>
        IsKnown(value) ? value!.Trim().ToLowerInvariant() : Optional;
}

public static class MfaMethodTypes
{
    public const string Totp = "totp";
    public const string Email = "email";

    /// <summary>A passkey or a security key, verified with WebAuthn.</summary>
    public const string Passkey = "passkey";

    public static readonly string[] All = [Totp, Email, Passkey];
}

public static class AuthChallengePurposes
{
    /// <summary>A completed primary proof waiting for an enrolled second factor.</summary>
    public const string Mfa = "mfa";

    /// <summary>A fresh actual-MFA proof requested from an already signed-in session.</summary>
    public const string Reverify = "reverify";

    /// <summary>A completed primary proof that may only enroll a security method.</summary>
    public const string Enrollment = "enrollment";

    /// <summary>A CLI recovery credential exchanged for enrollment-only access.</summary>
    public const string Recovery = "recovery";
}

public static class EmailOtpPurposes
{
    public const string Login = "login";
    public const string Enrollment = "enrollment";
}

public static class SecurityEventKinds
{
    public const string LoginSucceeded = "login-succeeded";
    public const string LoginFailed = "login-failed";
    public const string MfaSucceeded = "mfa-succeeded";
    public const string MfaFailed = "mfa-failed";
    public const string MethodAdded = "method-added";
    public const string MethodRemoved = "method-removed";
    public const string RecoveryCodesRegenerated = "recovery-codes-regenerated";
    public const string RecoveryCodeUsed = "recovery-code-used";
    public const string TrustedDeviceAdded = "trusted-device-added";
    public const string TrustedDeviceRemoved = "trusted-device-removed";
    public const string SessionRevoked = "session-revoked";
    public const string PasswordChanged = "password-changed";
    public const string CliRecovery = "cli-recovery";
    public const string PolicyChanged = "policy-changed";
    public const string DesktopApproved = "desktop-approved";
    public const string IdentityLinked = "identity-linked";
    public const string IdentityUnlinked = "identity-unlinked";
    public const string EmailChanged = "email-changed";
}

/// <summary>
/// A second factor of one account. Seeds and verification material never leave
/// the server; a status endpoint exposes only metadata.
/// </summary>
public sealed class MfaMethod
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Type { get; set; }
    public required string Name { get; set; }
    public DateTime CreatedAt { get; set; }

    /// <summary>Null while an enrollment is still waiting for its first valid code.</summary>
    public DateTime? ConfirmedAt { get; set; }

    public DateTime? LastUsedAt { get; set; }

    /// <summary>The Data Protection payload of a TOTP seed, bound to the account and method.</summary>
    public string? ProtectedSecret { get; set; }

    /// <summary>The exact address an e-mail method was verified against, in normalized form.</summary>
    public string? EmailAddress { get; set; }

    /// <summary>The last accepted RFC 6238 timestep, written conditionally so it can be accepted once.</summary>
    public long? LastTotpStep { get; set; }

    public DateTime? RevokedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>A one-time fallback proof. Only a digest is stored.</summary>
public sealed class RecoveryCode
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid BatchId { get; set; }
    public required string CodeHash { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UsedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// A remembered-device credential. It is a revocable random secret of its own,
/// never an IP or user-agent fingerprint, and it never refreshes the time of a
/// real second-factor proof.
/// </summary>
public sealed class TrustedDevice
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string TokenHash { get; set; }
    public required string Name { get; set; }
    public required string Device { get; set; }
    public string IpAddress { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// A short-lived, browser-bound capability issued after a primary proof but
/// before a required second factor or enrollment is finished.
/// </summary>
public sealed class AuthChallenge
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Purpose { get; set; }
    public required string SecretHash { get; set; }
    public required string PrimarySource { get; set; }

    /// <summary>
    /// The signed-in session that started a lifecycle/reverification challenge.
    /// It must still be active when the challenge completes.
    /// </summary>
    public Guid? ParentSessionId { get; set; }

    public int SecurityVersion { get; set; }

    /// <summary>The session this challenge ends in is short-lived, as the sign-in asked.</summary>
    public bool ShortLived { get; set; }

    /// <summary>
    /// The options of the passkey ceremony this challenge started, exactly as
    /// the server generated them. The answer is checked against these, never
    /// against options sent back by the browser, and they are cleared on use.
    /// </summary>
    public string? WebAuthnOptions { get; set; }

    public int Attempts { get; set; }
    public int MaxAttempts { get; set; } = 5;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// An e-mail verification code. The code itself is protected with Data
/// Protection; only the protected payload and metadata are stored.
/// </summary>
public sealed class EmailOtpCode
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? MethodId { get; set; }

    /// <summary>The browser-bound authentication/enrollment challenge this code belongs to.</summary>
    public Guid? ChallengeId { get; set; }

    public required string Purpose { get; set; }
    public required string EmailAddress { get; set; }
    public required string ProtectedCode { get; set; }
    public int Attempts { get; set; }
    public int MaxAttempts { get; set; } = 5;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// The one credential an operator CLI may issue after an MFA recovery. It can
/// only be exchanged for enrollment-only access, never for an ordinary session.
/// </summary>
public sealed class CliRecoveryCredential
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string TokenHash { get; set; }
    public required string Reason { get; set; }

    /// <summary>The account security version at issue; a later change makes the credential stale.</summary>
    public int SecurityVersion { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>An account-global security fact, independent of any one server.</summary>
public sealed class SecurityEvent
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Kind { get; set; }
    public string Detail { get; set; } = "";
    public string IpAddress { get; set; } = "";
    public string Device { get; set; } = "";
    public DateTime CreatedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// A durable alert waiting to be delivered to a verified address. Delivery
/// failures are retried separately and never roll back the security event.
/// </summary>
public sealed class SecurityNotification
{
    public Guid Id { get; set; }
    public Guid SecurityEventId { get; set; }
    public Guid UserId { get; set; }
    public required string EmailAddress { get; set; }
    public int Attempts { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public DateTime? SentAt { get; set; }
    public string LastError { get; set; } = "";

    public SecurityEvent SecurityEvent { get; set; } = null!;
    public User User { get; set; } = null!;
}

/// <summary>
/// The public half of a passkey or a security key. The private key never
/// leaves the authenticator. The method row it belongs to decides whether it
/// still counts: removing the method or an operator's recovery ends it.
/// </summary>
public sealed class WebAuthnCredential
{
    public Guid Id { get; set; }
    public Guid MethodId { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The authenticator's id for the credential, unique across the instance.</summary>
    public required byte[] CredentialId { get; set; }

    /// <summary>The COSE public key the signatures are checked with.</summary>
    public required byte[] PublicKey { get; set; }

    /// <summary>The user handle given at registration; a passkey returns it at sign-in.</summary>
    public required byte[] UserHandle { get; set; }

    public long SignCount { get; set; }
    public bool BackupEligible { get; set; }
    public bool BackedUp { get; set; }
    public Guid AaGuid { get; set; }

    /// <summary>How the browser can reach the authenticator, comma-separated, as hints only.</summary>
    public string Transports { get; set; } = "";

    public DateTime CreatedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }

    public MfaMethod Method { get; set; } = null!;
    public User User { get; set; } = null!;
}

/// <summary>
/// A sign-in with a passkey and no password, between the options and the
/// answer. It names no account: the passkey does. The browser holds the
/// secret in a cookie, and only its digest is stored.
/// </summary>
public sealed class PasskeySignIn
{
    public Guid Id { get; set; }
    public required string SecretHash { get; set; }

    /// <summary>The options as the server generated them.</summary>
    public required string Options { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
}
