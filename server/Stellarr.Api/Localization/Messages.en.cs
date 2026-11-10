namespace Stellarr.Api.Localization;

public sealed partial class Messages
{
    // An undefined enum value is a bug of its own; what the compiler must still
    // report is a key without a text.
#pragma warning disable CS8524
    private static string English(MessageKey key) => key switch
    {
        // Client gate and sign-in
        MessageKey.ClientUnsupported => "This app is no longer supported. Download the current Stellarr client.",
        MessageKey.ClientVersionMissing => "This app does not report its version and is not supported.",
        MessageKey.ClientOutdated => "This version of the app ({reported}) is too old. {minimum} or newer is required.",
        MessageKey.SignInFailed => "Invalid username or password.",

        // Passwords and accounts
        MessageKey.PasswordTooShort => "Password must be at least {min} characters long.",
        MessageKey.PasswordTooLong => "Password can be at most {max} characters long.",
        MessageKey.NewPasswordTooLong => "New password can be at most {max} characters long.",
        MessageKey.RecoveryEmailChangeDisabled => "Changing the recovery address requires confirming the new address and is currently turned off.",
        MessageKey.VadSensitivityRange => "Speech detection sensitivity must be between 0 and 100.",
        MessageKey.JoinSoundNotAvailable => "Pick a sound from the soundboard of a server you are on.",
        MessageKey.AccountDisplayNameLength => "Display name must be 1 to {max} characters long.",
        MessageKey.BioTooLong => "Bio can be at most {max} characters long.",
        MessageKey.CustomStatusTooLong => "Status can be at most {max} characters long.",
        MessageKey.PronounsTooLong => "Pronouns can be at most {max} characters long.",
        MessageKey.PasswordResetLinkInvalid => "The password reset link is invalid or has expired.",

        // Registration
        MessageKey.InviteUnusable => "The invite has expired, reached its use limit or is invalid.",
        MessageKey.InviteRequired => "An invite is required to create an account on an existing instance.",
        MessageKey.InviteServerGone => "The server the invite points to no longer exists.",
        MessageKey.InstanceHasNoMemberRole => "The instance has no role for new users.",
        MessageKey.UsernameInvalid => "Username must be 3–32 characters: letters, digits, dot, hyphen or underscore.",
        MessageKey.RegistrationDisplayNameLength => "Display name must be 1 to 64 characters long.",
        MessageKey.EmailInvalid => "Enter a valid e-mail address.",
        MessageKey.UsernameTaken => "This username is already taken.",
        MessageKey.EmailTaken => "An account with this e-mail address already exists.",

        // Channels and sections
        MessageKey.ChannelNameOrKindInvalid => "The channel name or type is invalid.",
        MessageKey.ChannelNameInvalid => "The channel name is invalid.",
        MessageKey.ChannelSettingInvalid => "At least one channel setting is invalid.",
        MessageKey.ChannelSettingWrongKind => "This setting does not fit the type of the channel.",
        MessageKey.ChannelOrderIncomplete => "The list must contain every channel exactly once.",
        MessageKey.SectionNameInvalid => "The section name is invalid.",
        MessageKey.SectionOrderIncomplete => "The list must contain every section exactly once.",

        // Messages
        MessageKey.ReactionInvalid => "A reaction must be 1 to {max} characters long and cannot contain spaces.",
        MessageKey.PinLimitReached => "A channel can have at most {max} pinned messages. Unpin one to make room.",
        MessageKey.AttachmentLimit => "A message can contain at most {max} attachments.",
        MessageKey.MessageIdInvalid => "The message identifier is invalid.",
        MessageKey.MessageContentInvalid => "A message must contain text or an attachment and be at most {max} characters long.",
        MessageKey.ReplyTargetInvalid => "A reply must point to an existing message in the same channel.",
        MessageKey.AttachmentsNotFound => "At least one attachment does not exist or belongs to another user.",
        MessageKey.SlowModeActive => "Slow mode is on",
        MessageKey.SlowModeWait => "You can send the next message in {seconds} s.",
        MessageKey.VoiceMessageAlone => "A voice message must be sent on its own, without text or other attachments.",
        MessageKey.MessageEditContentInvalid => "A message must contain text and be at most {max} characters long.",

        // Message history and search
        MessageKey.PageLimitRange => "The limit must be between 1 and {max}.",
        MessageKey.HistoryCursorInvalid => "The message history cursor is invalid.",
        MessageKey.DirectHistoryCursorInvalid => "The direct message history cursor is invalid.",
        MessageKey.SyncCursorInvalid => "The sync cursor or the limit is invalid.",
        MessageKey.SearchQueryLength => "The search phrase must be {min} to {max} characters long.",
        MessageKey.IndexKindInvalid => "The index kind must be all, media or links.",
        MessageKey.IndexCursorInvalid => "The message index cursor is invalid.",

        // Roles and permissions
        MessageKey.PermissionUnknown => "At least one permission is unknown.",
        MessageKey.PermissionAllowedAndDenied => "The same permission cannot be both allowed and denied.",
        MessageKey.RoleInvalid => "The name, color or list of permissions of the role is invalid.",

        // Operator panel
        MessageKey.OpsUserInvalid => "Check the username, display name, e-mail and password (at least 8 characters).",
        MessageKey.OpsRoleMustNotBeOwner => "Pick a role other than owner.",
        MessageKey.OpsCannotDisableSelf => "You cannot disable your own account.",
        MessageKey.OpsCannotDisableOwner => "The owner's account cannot be disabled.",
        MessageKey.OpsInstanceNameLength => "The instance name must be 1 to 80 characters long.",
        MessageKey.OpsPublicUrlInvalid => "Enter an absolute HTTPS address. HTTP is allowed only for localhost.",
        MessageKey.OpsTimeZoneUnavailable => "This time zone is not available on the server.",
        MessageKey.OpsTimeZoneBroken => "The time zone configuration on the server is invalid.",
        MessageKey.OpsMailFromRequired => "Mailing needs a valid sender address when it is turned on.",
        MessageKey.OpsBackupRetentionRange => "Backup retention must be 1 to {max} days.",
        MessageKey.OpsLogRetentionRange => "Log retention must be 1 to {max} days.",
        MessageKey.OpsOrphanRetentionRange => "Orphaned object retention must be 1 to {max} days.",
        MessageKey.OpsVersionInvalid => "Enter a stable version in the major.minor.patch format.",
        MessageKey.OpsRecommendedBelowMinimum => "The recommended version cannot be lower than the minimum.",
        MessageKey.OpsReleaseManifestBroken => "The app release manifest needs repair.",
        MessageKey.OpsVersionsSavedManifestBroken => "The versions were saved, but the app release manifest needs repair.",
        MessageKey.OpsTestMailRecipientInvalid => "Enter a valid recipient address.",
        MessageKey.OpsMailNotReadyTitle => "Resend is not ready",
        MessageKey.OpsMailNotReadyDetail => "Turn on mailing, set the sender address and add Mail__ResendApiKey to the backend environment.",
        MessageKey.OpsBackupFailedIntegrity => "The backup failed the integrity check.",
        MessageKey.OpsDatabaseHealthy => "The connection and the check query work.",
        MessageKey.OpsDatabaseDown => "The database does not respond.",
        MessageKey.OpsRealtimeConnections => "Active connections: {count}",
        MessageKey.OpsMaintenanceRunning => "Retention is running.",
        MessageKey.OpsMaintenanceOff => "Turned off in the configuration.",
        MessageKey.OpsStorageInitializationOff => "Initialization is turned off.",
        MessageKey.OpsStorageChecked => "The bucket was checked at start-up.",

        // Uploads and images
        MessageKey.FileEmpty => "The file is empty.",
        MessageKey.ImageTypesAllowed => "Only JPEG, PNG, GIF and WebP images are allowed.",
        MessageKey.FileContentMismatch => "The content of the file does not match its declared type.",
        MessageKey.UploadTypeUnsupported => "Unsupported attachment type",
        MessageKey.UploadTypesAllowed => "Supported images, audio and video, and PDF, ZIP, TXT, JSON, DOCX, XLSX and PPTX files are allowed.",
        MessageKey.UploadTooLarge => "The attachment is too large",
        MessageKey.UploadImageMaximum => "The maximum image size is 10 MB.",
        MessageKey.UploadAudioMaximum => "The maximum audio size is 25 MB.",
        MessageKey.UploadVideoMaximum => "The maximum video size is 100 MB.",
        MessageKey.UploadFileMaximum => "The maximum file size is 25 MB.",
        MessageKey.UploadOverLimit => "The attachment exceeds the limit.",
        MessageKey.UploadTypeMismatch => "Invalid attachment format",
        MessageKey.UploadPosterInvalid => "The video preview is invalid.",
        MessageKey.VoiceMessageInvalid => "A voice message must be an audio recording of up to {minutes} minutes.",
        MessageKey.MediaDurationInvalid => "The duration of the file is invalid.",
        MessageKey.MediaDimensionsInvalid => "The dimensions of the file are invalid.",
        MessageKey.StorageFull => "No room for the attachment",
        MessageKey.StorageUserQuota => "The storage limit of this account has been used up.",
        MessageKey.StorageInstanceQuota => "The instance has used up the configured storage limit for attachments.",
        MessageKey.StorageLowDisk => "The server keeps a reserve of free space for the database and the logs.",
        MessageKey.StorageUnavailable => "The server cannot accept another attachment right now.",
        MessageKey.ServerNameLength => "The server name must be 1 to 80 characters long.",
        MessageKey.ServerDescriptionLength => "The server description can be at most 280 characters long.",
        MessageKey.ServerIconTooLarge => "The icon is too large",
        MessageKey.ServerIconMaximum => "A server icon can be at most 4 MB.",
        MessageKey.ServerIconTypeUnsupported => "Unsupported icon format",
        MessageKey.ServerIconTypeMismatch => "Invalid icon format",
        MessageKey.ProfileImageTooLarge => "The image is too large",
        MessageKey.ProfileImageTypeUnsupported => "Unsupported image format",
        MessageKey.ProfileImageTypeMismatch => "Invalid image format",
        MessageKey.AvatarMaximum => "An avatar can be at most 4 MB.",
        MessageKey.BannerMaximum => "A banner can be at most 8 MB.",
        MessageKey.EmojiShortcodeInvalid => "The name must be 2–32 characters: lowercase letters, digits or underscores.",
        MessageKey.EmojiLimitReached => "The emoji limit has been reached",
        MessageKey.EmojiLimitDetail => "A server can have at most {max} custom emoji.",
        MessageKey.EmojiTooLarge => "The emoji is too large",
        MessageKey.EmojiMaximum => "The maximum size of an emoji file is 512 KB.",
        MessageKey.EmojiTypeUnsupported => "Unsupported emoji format",
        MessageKey.EmojiTypeMismatch => "Invalid emoji format",

        // Servers
        MessageKey.ChannelUnknown => "Unknown channel.",
        MessageKey.TransferTargetInvalid => "Pick another member of the server.",
        MessageKey.ServerNameOrDescriptionInvalid => "The name must be 1–80 characters long and the description at most 280.",
        MessageKey.StarterChannelNameInvalid => "The name of the starter channel is invalid.",
        MessageKey.StarterChannelNamesCollide => "The starter channels must have different names.",
        MessageKey.ServerHasNoMemberRole => "The server has no role for new members.",

        // Soundboard
        MessageKey.SoundAttachmentInvalid => "Pick an uploaded audio file with a known duration.",
        MessageKey.SoundInvalid => "The name must be 1–32 characters, the symbol 1–16 characters and the clip {min}–{max} s.",

        // Client releases
        MessageKey.AndroidReleaseUnavailable => "The Android release is temporarily unavailable.",
        MessageKey.DesktopReleaseUnavailable => "The desktop release is temporarily unavailable.",
        MessageKey.ReleaseListUnavailable => "The list of app releases is temporarily unavailable.",
        MessageKey.DesktopUpdateUnavailable => "The desktop update is temporarily unavailable.",

        // Friends and moderation
        MessageKey.FriendUsernameRequired => "Enter a username.",
        MessageKey.BanReasonTooLong => "A ban reason can be at most {max} characters long.",

        // Desktop browser sign-in
        MessageKey.BrowserLoginExpiredHeading => "The link has expired",
        MessageKey.BrowserLoginExpiredBody => "Go back to Stellarr Desktop and start signing in again.",
        MessageKey.BrowserLoginApprovedByAnother => "This sign-in was already approved by another account.",
        MessageKey.BrowserLoginDoneHeading => "Signed in to Stellarr",
        MessageKey.BrowserLoginDoneBody => "You can close this tab and return to the desktop app.",
        MessageKey.BrowserLoginLinkInvalid => "The sign-in link is invalid or has expired.",
    };
#pragma warning restore CS8524
}
