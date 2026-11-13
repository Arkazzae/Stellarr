namespace Stellarr.Api.Domain;

public sealed class User
{
    public Guid Id { get; set; }
    public required string Username { get; set; }
    public required string NormalizedUsername { get; set; }
    public required string DisplayName { get; set; }
    public required string PasswordHash { get; set; }
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public bool IsDisabled { get; set; }

    /// <summary>Incremented when credentials change, which invalidates older cookies.</summary>
    public int SessionVersion { get; set; }

    /// <summary>
    /// Set by an operator CLI recovery. Ordinary primary flows cannot create a
    /// session or enrollment grant until a CLI credential has been redeemed and
    /// a replacement factor has been confirmed.
    /// </summary>
    public bool SecurityRecoveryRequired { get; set; }

    public required string AvatarColor { get; set; }
    public DateTime CreatedAt { get; set; }

    // The profile fields stay nullable: an account that never opened the
    // settings dialog is complete, and clients fall back to initials drawn on
    // AvatarColor.

    /// <summary>
    /// A path this server serves (<c>/assets/{id}</c> for an upload), never a
    /// foreign host, so a profile picture cannot point a reader's browser at
    /// somewhere we do not control. Built-in fallback art is derived from
    /// <see cref="Id"/> by the clients and is not stored.
    /// </summary>
    public string? AvatarUrl { get; set; }

    /// <summary>Same rules as <see cref="AvatarUrl"/>.</summary>
    public string? BannerUrl { get; set; }

    /// <summary>A short, public line about what the person is doing right now.</summary>
    public string? CustomStatus { get; set; }

    /// <summary>Free text the person wrote about themselves, stored verbatim.</summary>
    public string? Bio { get; set; }

    /// <summary>As typed ("ona/jej", "he/him"): printed, never parsed.</summary>
    public string? Pronouns { get; set; }

    public UserPreferenceSettings? Preferences { get; set; }
}

/// <summary>Account preferences that follow a person between devices.</summary>
public sealed class UserPreferenceSettings
{
    public Guid UserId { get; set; }
    public bool DesktopNotifications { get; set; } = true;
    public bool EmailNotifications { get; set; }
    public bool PushNotifications { get; set; }
    public bool MentionsOnly { get; set; } = true;
    public bool MessageSound { get; set; } = true;
    public bool JoinLeaveSound { get; set; } = true;
    public bool AllowDirectMessages { get; set; } = true;
    public bool AllowFriendRequests { get; set; } = true;
    public bool ShowPresence { get; set; } = true;

    /// <summary>The web client's "Copy ID" preference.</summary>
    public bool DeveloperMode { get; set; }

    public bool ReducedMotion { get; set; }

    /// <summary>JSON array of the text-channel ids this user muted.</summary>
    public string MutedChannelIdsJson { get; set; } = "[]";

    public int VadSensitivity { get; set; } = 60;

    /// <summary>
    /// Soundboard clip played when this person joins a voice room, or null to
    /// leave the shared arrival chime alone. Deliberately not a foreign key:
    /// the sound belongs to a server this account may later leave, and a
    /// selection that is no longer playable must read as silence instead of
    /// breaking the account it hangs off.
    /// </summary>
    public Guid? JoinSoundId { get; set; }

    /// <summary>
    /// The web client's own settings, one JSON object per section, written as
    /// the client sent them: how the app looks, the language it speaks, the
    /// call shortcuts and the voice processing. The client validates every
    /// field on the way back in, so the server only checks the shape and the
    /// size. Null means no device has saved the section yet.
    /// </summary>
    public string? AppearanceSettingsJson { get; set; }

    /// <inheritdoc cref="AppearanceSettingsJson"/>
    public string? LanguageSettingsJson { get; set; }

    /// <inheritdoc cref="AppearanceSettingsJson"/>
    public string? KeybindSettingsJson { get; set; }

    /// <inheritdoc cref="AppearanceSettingsJson"/>
    public string? VoiceSettingsJson { get; set; }

    public User User { get; set; } = null!;
}
