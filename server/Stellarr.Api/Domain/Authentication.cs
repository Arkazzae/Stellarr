namespace Stellarr.Api.Domain;

/// <summary>
/// A one-time password recovery credential. Only its SHA-256 digest is stored;
/// the token itself lives briefly in the recovery link that is mailed out.
/// </summary>
public sealed class PasswordResetToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string TokenHash { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// A manually approved link between a local account and an OpenID Connect
/// subject. Issuer and subject are the only stable identity key; the email
/// address is neither stored nor used to link accounts automatically.
/// </summary>
public sealed class ExternalIdentity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Issuer { get; set; }
    public required string Subject { get; set; }
    public DateTime CreatedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>A revocable login, carried by one claim in the encrypted cookie.</summary>
public sealed class UserSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Device { get; set; }
    public required string IpAddress { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    public User User { get; set; } = null!;
}

/// <summary>
/// A short-lived, single-use handoff from an authenticated system browser to
/// the cookie jar of a desktop client. Only a digest of the client's secret is
/// stored, and the browser never sees the secret or the final session cookie.
/// </summary>
public sealed class DesktopBrowserLogin
{
    public Guid Id { get; set; }
    public required string SecretHash { get; set; }

    /// <summary>The account that approved the login, or null while it is still pending.</summary>
    public Guid? UserId { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? RedeemedAt { get; set; }

    public User? User { get; set; }
}
