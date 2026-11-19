/** Wire types shared by the HTTP client, the realtime hub and the UI ports. */

import type { MessageKey } from "@/i18n";
import type { OpusProfileId } from "@/lib/voice/settings";

export type UserId = string;
export type ChannelId = string;
export type MessageId = string;
export type AttachmentId = string;

/**
 * `dnd` is still reachable: the person is there and asked not to be
 * interrupted. Anything that asks "can I get hold of them" groups it with
 * `online`; only `offline` means no.
 */
export type Presence = "online" | "idle" | "dnd" | "offline";

/** Catalog keys for the wording of someone else's presence. Gender-neutral, since it sits next to a name. */
export const PRESENCE_LABEL: Record<Presence, MessageKey> = {
  online: "presence.online",
  idle: "presence.idle",
  dnd: "presence.dnd",
  offline: "presence.offline",
};

/**
 * Catalog keys for the wording of your own presence, phrased as a choice
 * rather than an observation: looking absent is "Invisible", while "Offline"
 * is only ever a fact about somebody else.
 */
export const SELF_PRESENCE_LABEL: Record<Presence, MessageKey> = {
  online: "account.presence.onlineLabel",
  idle: "account.presence.idleLabel",
  dnd: "account.presence.dndLabel",
  offline: "account.presence.offlineLabel",
};

export const PRESENCE_VALUES: readonly Presence[] = [
  "online",
  "idle",
  "dnd",
  "offline",
];

export function isPresence(value: unknown): value is Presence {
  return (
    typeof value === "string" && PRESENCE_VALUES.includes(value as Presence)
  );
}

/**
 * Profile fields are all optional: a server that predates profiles still
 * returns a valid `User`, and the UI falls back to a built-in mascot avatar
 * and scene banner picked by id (`/identity/…`), with initials as the
 * avatar's load-error fallback. Uploaded images always point at our own host
 * (`/assets/…`), never at a third party.
 */
export interface User {
  id: UserId;
  username: string;
  displayName: string;
  presence: Presence;
  avatarUrl?: string;
  bannerUrl?: string;
  /** A short status line, distinct from the longer bio. */
  customStatus?: string;
  /** Plain text, never markup. */
  bio?: string;
  /** Printed as typed ("ona/jej", "he/him"), never parsed. */
  pronouns?: string;
}

/** Private account data, returned only for the signed-in user. */
export interface AccountDetails {
  id: UserId;
  username: string;
  displayName: string;
  email?: string;
  createdAt: string;
  avatarUrl?: string;
  bannerUrl?: string;
  customStatus: string;
  bio: string;
  pronouns: string;
  preferences: AccountPreferences;
}

/** The parts of the client's own settings that the account keeps, one object each. */
export const CLIENT_SETTINGS_SECTIONS = ["appearance", "language", "keybinds", "voice", "privacy"] as const;
export type ClientSettingsSection = (typeof CLIENT_SETTINGS_SECTIONS)[number];

/**
 * The client's own settings as the account holds them: one object per section,
 * null for a section no device has saved. The fields are the client's and are
 * normalised by whoever reads them, since another build may have written them.
 */
export type ClientSettingsSnapshot = Record<ClientSettingsSection, Record<string, unknown> | null>;

export interface AccountPreferences {
  desktopNotifications: boolean;
  mentionPopups: boolean;
  callRingtone: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  mentionsOnly: boolean;
  messageSound: boolean;
  joinLeaveSound: boolean;
  allowDirectMessages: boolean;
  allowFriendRequests: boolean;
  showPresence: boolean;
  developerMode: boolean;
  reducedMotion: boolean;
  mutedChannelIds: string[];
  vadSensitivity: number;
  /** Soundboard sound that announces this account's arrivals; null is the chime. */
  joinSoundId: string | null;
}

export interface AccountUpdateInput {
  displayName?: string;
  email?: string;
  customStatus?: string;
  bio?: string;
  pronouns?: string;
}

export type AccountImageKind = "avatar" | "banner";

export type PasswordChangeAnswer =
  | "changed"
  | "wrong-current"
  | "too-short"
  | "same-as-current"
  | "second-step-required";

/** What asking for a new address can answer; only "sent" mailed a link. */
export type EmailChangeAnswer =
  | "sent"
  | "wrong-password"
  | "second-step-required"
  | "same"
  | "taken"
  | "mail-unavailable";

/** What opening the link in the mail can answer. */
export type EmailConfirmAnswer = "changed" | "invalid" | "taken";

export interface Server {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  /** ISO 8601. Optional only for fixtures written against older contracts. */
  createdAt?: string;
  isPublic?: boolean;
}

export interface ChannelReadChanged {
  channelId: ChannelId;
  lastReadAt: string;
}

export const SERVER_PERMISSION_VALUES = [
  "manageServer",
  "manageChannels",
  "manageRoles",
  "manageMembers",
  "manageMessages",
  "moderateMembers",
  "manageBans",
  "viewAuditLog",
] as const;
export type ServerPermission = (typeof SERVER_PERMISSION_VALUES)[number];

export interface ServerRole {
  id: string;
  name: string;
  color: string;
  permissions: ServerPermission[];
  memberCount: number;
  isSystem: boolean;
  isOwner: boolean;
}

export interface ServerMember {
  user: User;
  roleId: string;
  joinedAt: string;
}

export interface ServerBan {
  userId: UserId;
  displayName: string;
  bannedByName: string;
  reason: string;
  bannedAt: string;
}

export type ChannelKind = "text" | "voice";

export interface Channel {
  id: ChannelId;
  name: string;
  kind: ChannelKind;
  topic?: string;
  slowModeSeconds?: number;
  hideAfterInactivityHours?: number;
  audioProfile?: OpusProfileId;
  userLimit?: number;
  /** Server-defined order within the rail. */
  position?: number;
  /** The rail section this channel sits under; absent when unsectioned. */
  sectionId?: string;
}

/** Where one channel sits in the rail: its place in the order is where it is listed. */
export interface ChannelPlacement {
  id: ChannelId;
  /** Null outside sections. */
  sectionId: string | null;
}

/** One channel filed under another section, or under none, as part of a reorder. */
export interface ChannelSectionMove {
  channelId: ChannelId;
  sectionId: string | null;
}

/** Everything but the name is optional and falls back to what the server seeds. */
export interface NewServer {
  name: string;
  description?: string;
  isPublic?: boolean;
  /** First text channel; the server picks its own default name when absent. */
  textChannelName?: string;
  /** First voice channel; an empty string creates the server without one. */
  voiceChannelName?: string;
  /** False makes every message notify by default, not only mentions. */
  mentionsOnly?: boolean;
  voiceJoinSound?: boolean;
}

/** A named, collapsible group of channels in the rail. */
export interface Section {
  id: string;
  name: string;
  position: number;
}

export interface ChannelUpdateInput {
  name?: string;
  topic?: string;
  slowModeSeconds?: number;
  hideAfterInactivityHours?: number;
  audioProfile?: OpusProfileId;
  userLimit?: number;
}

export interface Attachment {
  id: AttachmentId;
  url: string;
  name: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  /** Playback length, measured from the uploaded audio or video. */
  durationSeconds?: number;
  /** A frame the server extracted from the uploaded video. */
  posterUrl?: string;
  /** A reduced still copy of an uploaded image, for small views. */
  previewUrl?: string;
  /** The picture in a few bytes, standard padded base64; see `lib/media/placeholder`. */
  placeholder?: string;
  /** A recording made in the composer and sent on its own. */
  isVoiceMessage?: boolean;
}

export interface SoundboardSound {
  id: string;
  name: string;
  glyph: string;
  url: string;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
}

export interface SoundboardSettings {
  everyoneCanPlay: boolean;
  rateLimited: boolean;
}

export interface SoundboardSnapshot {
  sounds: SoundboardSound[];
  settings: SoundboardSettings;
  canManage: boolean;
  /** Whether the server lets this caller play sounds, by the same rule the hub applies. */
  canPlay: boolean;
}

export interface SoundboardPlayedEvent {
  playbackId: string;
  channelId: ChannelId;
  triggeredByUserId: UserId;
  startsAtUnixMs: number;
  sound: SoundboardSound;
}

/** One server's soundboard, offered as arrival sounds to one of its members. */
export interface JoinSoundServerGroup {
  serverId: string;
  serverName: string;
  iconUrl?: string;
  sounds: SoundboardSound[];
}

export interface JoinSoundLibrary {
  /** The audible window; every sound below already arrives cut to it. */
  maxSeconds: number;
  /** May name a sound no group holds, such as one from a server since left. */
  selectedId: string | null;
  servers: JoinSoundServerGroup[];
}

export interface MessageAuthor {
  id: UserId;
  displayName: string;
}

export type EmbedKind = "link" | "video";

/**
 * A link the server unfurled. It is derived from the message body, so every
 * text field is treated as coming from a stranger, and `thumbnailUrl` is
 * always one of our own `/assets/…` paths: the server copies preview images
 * instead of pointing the reader's browser at another host.
 */
export interface MessageEmbed {
  id: string;
  url: string;
  kind: EmbedKind;
  /** "youtube", "vimeo", or the host for a plain card. */
  provider: string;
  /** The id a video player needs; absent on link cards. */
  providerId?: string;
  startSeconds?: number;
  domain: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
}

export interface Message {
  id: MessageId;
  channelId: ChannelId;
  author: MessageAuthor;
  content: string;
  attachments: Attachment[];
  /** In the order the links appear in `content`. */
  embeds: MessageEmbed[];
  /** ISO 8601. */
  createdAt: string;
  /**
   * ISO 8601; absent means never edited. A timestamp rather than a flag so
   * the reader can tell a typo fix from a rewrite.
   */
  editedAt?: string;
  /**
   * ISO 8601; absent means not pinned. The pinned list is ordered by it, most
   * recently pinned first.
   */
  pinnedAt?: string;
  /** The message this one answers. */
  replyTo?: MessageReference;
  /** Durable aggregates, from the point of view of the signed-in reader. */
  reactions?: MessageReaction[];
  /**
   * Direct messages only: the end-to-end encrypted body, with `content` empty.
   * The friends adapter decrypts it and takes this field off, so nothing above
   * the adapter ever holds ciphertext.
   */
  encrypted?: EncryptedBody;
  /** Direct messages only: an entry about the conversation itself, not a message. */
  line?: TimelineLine;
  /**
   * Set by the client on an encrypted message this browser cannot read, and on
   * the one entry that stands for a run of them.
   */
  sealed?: SealedMessages;
  /** Set by the client on the plaintext of an end-to-end encrypted message. */
  decrypted?: true;
}

/** An encrypted direct message as the server stores it: opaque to it. */
export interface EncryptedBody {
  epochId: string;
  /** base64, 12 bytes. */
  iv: string;
  /** base64, AES-GCM output with its tag. */
  ciphertext: string;
}

export const TIMELINE_LINE_KINDS = [
  "encryption_requested",
  "encryption_request_cancelled",
  "encryption_enabled",
  "encryption_disabled",
  "device_added",
  "keys_reset",
] as const;
export type TimelineLineKind = (typeof TIMELINE_LINE_KINDS)[number];

export interface TimelineLine {
  kind: TimelineLineKind;
  /** The person it is about; also the entry's author. */
  actorId: UserId;
}

/**
 * Why this browser cannot read an encrypted message.
 *
 * `pin`: the account key opens it, and the account key is in the PIN backup.
 * `lost`: nothing this browser has or can get opens it (an epoch from before a
 * reset, or one wrapped before this account had a key).
 * `unsupported`: this browser cannot do the cryptography at all.
 */
export type SealedReason = "pin" | "lost" | "unsupported";

export interface SealedMessages {
  reason: SealedReason;
  /** How many messages the entry stands for; 1 straight from the adapter. */
  count: number;
}

/* --------------------------------------------------------- encryption */

export type ConversationEncryptionState = "off" | "requested" | "on";

export interface ConversationEncryption {
  state: ConversationEncryptionState;
  /** Only while "requested". */
  requestedById: UserId | null;
  requestedAt: string | null;
  /** Only while "on": when it was switched on this time. */
  enabledAt: string | null;
  /** Only while "on"; null until the first epoch after switching on. */
  currentEpochId: string | null;
}

export const ENCRYPTION_OFF: ConversationEncryption = {
  state: "off",
  requestedById: null,
  requestedAt: null,
  enabledAt: null,
  currentEpochId: null,
};

/** Every byte field below is base64 with padding, as on the wire. */
export interface PublicKeyRecord {
  keyId: string;
  algorithm: string;
  publicKey: string;
  createdAt: string;
}

export interface KeyBackupStatus {
  iterations: number;
  failedAttempts: number;
  remainingAttempts: number;
  updatedAt: string;
}

export interface OwnDevice {
  /** Also the device's key id. */
  id: string;
  algorithm: string;
  publicKey: string;
  /** "Chrome, macOS", as the browser described itself. */
  label: string;
  createdAt: string;
  lastSeenAt: string;
  /** The device of the session asking. */
  current: boolean;
}

export interface EncryptionAccount {
  accountKey: PublicKeyRecord | null;
  backup: KeyBackupStatus | null;
  device: OwnDevice | null;
}

export interface KeyBackupInput {
  salt: string;
  iterations: number;
  verifier: string;
  iv: string;
  ciphertext: string;
}

export interface BackupParameters {
  salt: string;
  iterations: number;
  remainingAttempts: number;
}

export interface UnlockedBackup {
  accountKeyId: string;
  iv: string;
  ciphertext: string;
}

export interface DeviceKeyRecord {
  keyId: string;
  algorithm: string;
  publicKey: string;
  createdAt: string;
}

export interface RecipientKey {
  keyId: string;
  kind: "account" | "device";
  userId: UserId;
}

export interface EpochEnvelope {
  recipientKeyId: string;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
}

export interface EncryptionEpoch {
  id: string;
  sequence: number;
  previousEpochId: string | null;
  createdById: UserId;
  createdAt: string;
  /** Exactly the keys the epoch was wrapped for. */
  recipients: RecipientKey[];
  /** Only the reader's own. */
  envelopes: EpochEnvelope[];
}

export interface PersonKeys {
  userId: UserId;
  accountKey: PublicKeyRecord | null;
  devices: DeviceKeyRecord[];
}

export interface ConversationKeys {
  conversationId: string;
  encryption: ConversationEncryption;
  self: PersonKeys;
  peer: PersonKeys;
  currentDeviceKeyId: string | null;
  /** Exactly what a new epoch must be wrapped for, right now. */
  recipients: RecipientKey[];
  currentEpoch: EncryptionEpoch | null;
}

export interface EpochPage {
  currentEpochId: string | null;
  epochs: EncryptionEpoch[];
  hasMore: boolean;
}

export type EncryptionSwitchAction = "request" | "cancel" | "confirm" | "disable";

export interface MessageReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** The authoritative aggregate, pushed after one user changes a reaction. */
export interface MessageReactionChanged {
  messageId: MessageId;
  channelId: ChannelId;
  emoji: string;
  count: number;
  userId: UserId;
  added: boolean;
}

export interface MessageDeleted {
  messageId: MessageId;
  channelId: ChannelId;
}

/**
 * Just enough of an answered message to draw the line above a reply. It is a
 * reference rather than the message because the original may be far outside
 * the loaded window and the line still has to render.
 */
export interface MessageReference {
  id: MessageId;
  authorId: UserId;
  authorName: string;
  /** One line, already shortened by whoever produced it. */
  preview: string;
  /** True when the answered message was a picture, a file or a recording. */
  hasAttachment?: boolean;
}

/** One channel thread as the left rail lists it. */
export interface ThreadSummary {
  channelId: ChannelId;
  root: MessageReference;
  replyCount: number;
  /** ISO 8601, of the newest reply. */
  lastReplyAt: string;
}

/** One backwards page of a channel history, oldest message first. */
export interface MessageHistoryPage {
  messages: Message[];
  /** Opaque token for the next older page; null at the channel's beginning. */
  nextCursor: string | null;
  /** Mutation cursor captured in the same database snapshot as this page. */
  syncCursor: string;
}

/** One backwards page of a private conversation, oldest message first. */
export interface DirectMessageHistoryPage {
  messages: Message[];
  /** Opaque token for the next older page; null at the conversation's beginning. */
  nextCursor: string | null;
}

export interface MessageSyncChange {
  cursor: string;
  kind: "upsert" | "delete";
  messageId: MessageId;
  message?: Message;
}

export interface MessageSyncPage {
  changes: MessageSyncChange[];
  nextCursor: string;
  hasMore: boolean;
  /** The server compacted changes older than the client's cursor. */
  resetRequired: boolean;
}

/** A server-indexed slice of the complete channel history. */
export type MessageIndexKind = "all" | "media" | "links";

export interface MessageIndexPage {
  /** Relevance order for a query, newest first otherwise. */
  messages: Message[];
  /** Opaque token for the next page. */
  nextCursor: string | null;
}

/** Sent once a message's link cards have been built. */
export interface MessageEmbedsUpdate {
  messageId: MessageId;
  channelId: ChannelId;
  embeds: MessageEmbed[];
}

export interface VoiceOccupant {
  userId: UserId;
  displayName: string;
  muted: boolean;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}


export interface RtcCapabilities {
  audioCodecs: string[];
  videoCodecs: string[];
  audioProcessing: string[];
  camera: boolean;
  screenShare: boolean;
  screenAudio: boolean;
}

/**
 * RTC parameters issued by the server. TURN credentials are per user and
 * short-lived, so they come from `/api/bootstrap`, never from the build.
 */
export interface RtcConfig {
  protocolVersion: number;
  capabilities: RtcCapabilities;
  iceServers: IceServerConfig[];
  signalingHub: string;
  mediaServer: string;
}

export interface Bootstrap {
  user: User;
  server: Server;
  /** Every server the account belongs to, in join order. */
  servers: Server[];
  channels: Channel[];
  sections: Section[];
  members: User[];
  /** The signed-in member's effective permissions. */
  permissions: ServerPermission[];
  /** Recent messages, newest last, possibly across several text channels. */
  messages: Message[];
  /** Per-channel read watermarks for the signed-in user. */
  channelReads?: Record<ChannelId, string>;
  /** Who is already in each voice channel when the client connects. */
  voice?: Record<ChannelId, VoiceOccupant[]>;
  /** ICE servers and transport mode for voice. */
  rtc?: RtcConfig;
}

export interface LoginInput {
  username: string;
  password: string;
  /** False asks for a session that ends with the browser; left out, it is kept. */
  keepSignedIn?: boolean;
  /**
   * Links the identity a provider confirmed for this browser once the
   * sign-in is complete, second step and all.
   */
  linkPending?: boolean;
}

export interface RegisterInput {
  username: string;
  displayName: string;
  email: string;
  /** Absent for an account made through a provider (`external`). */
  password?: string;
  /**
   * Makes the account from the identity a provider confirmed for this
   * browser, with no password, when that provider may create accounts.
   */
  external?: boolean;
  inviteCode?: string;
  /** The first server, sent only by the registration that founds the instance. */
  initialServer?: {
    name: string;
    description: string;
    textChannelName: string;
    /** Empty for no voice channel. */
    voiceChannelName: string;
  };
  /**
   * The code the API writes to its log while the instance has no account.
   * The founding registration needs it; later ones send none.
   */
  setupCode?: string;
}

/**
 * What an invite link leads to, as anyone who holds the link may see it
 * before signing in: the server, who invited, and for how long.
 */
export interface InvitePreview {
  server: { id: string; name: string; description: string; iconUrl: string | null };
  /** The channel the invite names, or null when it names none. */
  channel: { id: string; name: string } | null;
  inviter: { displayName: string; avatarColor: string; avatarUrl: string | null };
  /** Null for an invite that does not expire. */
  expiresAt: string | null;
}

/** An identity provider the account pages offer to sign in with, by the address that starts it. */
export interface SignInProvider {
  id: string;
  displayName: string;
  /** A sign-in route of this server: `/api/auth/oidc/login`, or `/api/auth/oidc/<id>/login`. */
  loginUrl: string;
  /** The owner lets it create accounts for people with an invite. */
  signUp: boolean;
}

/**
 * An identity a provider confirmed that no account here is linked to, as
 * the browser it came back to sees it. It says nothing about the accounts
 * here.
 */
export interface PendingIdentity {
  provider: { id: string; displayName: string };
  displayName: string | null;
  email: string | null;
  /** A login to suggest for an account made from it; empty when none could be made. */
  username: string;
  /** Its provider may create an account for someone with an invite. */
  signUp: boolean;
}

/** How linking an identity came out, in the words the link page reads. */
export type IdentityLinkOutcome = "linked" | "taken" | "other" | "failed";

export interface SendMessageInput {
  content: string;
  attachmentIds: AttachmentId[];
  /** Stable across retries; the server stores it as the message id. */
  clientMessageId?: MessageId;
  /** The message being answered; a server that does not know it ignores it. */
  replyToMessageId?: MessageId;
}

/** The persisted social graph returned by `/api/social`. */
export interface SocialFriend {
  user: User;
  since: string;
}

export interface SocialFriendRequest {
  id: string;
  user: User;
  direction: "incoming" | "outgoing";
  sentAt: string;
}

export interface SocialConversation {
  id: string;
  peer: User;
  lastMessage?: Message;
  unread: number;
  updatedAt: string;
  /** Absent from a server that predates encryption: off. */
  encryption?: ConversationEncryption;
}

export interface SocialState {
  friends: SocialFriend[];
  requests: SocialFriendRequest[];
  blocked: User[];
  conversations: SocialConversation[];
}

export type FriendRequestAnswer =
  | "sent"
  | "unknown-user"
  | "already-friends"
  | "already-sent"
  | "self"
  | "blocked";

// ---- Sign-in with a second factor -----------------------------------------

/** How a second-factor method proves who is signing in. */
export type MfaMethodType = "totp" | "email" | "passkey";

export interface MfaMethod {
  id: string;
  type: MfaMethodType;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  /** Only an email method names the address its codes go to. */
  emailAddress?: string;
  /** Started but not yet confirmed with a first code. */
  pending: boolean;
}

/**
 * Why a challenge exists: an ordinary sign-in, a required first method, a
 * replacement after an operator recovery, or a fresh proof before a change to
 * the account's security.
 */
export type MfaPurpose = "mfa" | "enrollment" | "recovery" | "reverify";

/**
 * A sign-in that has passed its first step and waits for a second factor, or
 * for a first method to be set up. The server keeps the secret half in an
 * HttpOnly cookie; `challengeId` only names it.
 */
export interface MfaChallenge {
  /** True when there is no method yet and one has to be set up first. */
  enrollment: boolean;
  challengeId: string;
  purpose: MfaPurpose;
  expiresAt: string;
  methods: MfaMethod[];
  /** This browser holds a trusted-device token the server will accept. */
  trustedDeviceAvailable: boolean;
  /** The account has a confirmed email method and mail can be sent. */
  emailCodeAvailable: boolean;
  /** How long "remember this device" lasts, as the instance sets it. */
  trustedDeviceDays: number;
  /** The server can register and check passkeys: it has a public HTTPS address. */
  passkeyAvailable: boolean;
  /**
   * Whose sign-in this is. Every challenge a sign-in or a registration starts
   * names it; one started from the account settings may not.
   */
  account?: ChallengeAccount;
}

/** The account a second step belongs to, as the step shows it. */
export interface ChallengeAccount {
  displayName: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
}

/** What the first step of a sign-in or a registration led to. */
export type AuthResult =
  /** `identityLink` says how linking the waiting identity went, when the sign-in asked for it. */
  | { kind: "signed-in"; user: User; identityLink?: IdentityLinkOutcome }
  | { kind: "challenge"; challenge: MfaChallenge }
  /** An operator reset the account's security; only a recovery credential gets back in. */
  | { kind: "recovery-required" };

export interface MfaVerifyInput {
  challengeId: string;
  /** Absent with a recovery code, which belongs to no method. */
  methodId?: string;
  code?: string;
  rememberDevice?: boolean;
  useTrustedDevice?: boolean;
}

/** The end of a challenge: a full session, and recovery codes when new ones were issued. */
export interface MfaCompletion {
  user: User;
  /** Shown once. Present only when this step issued them. */
  recoveryCodes?: string[];
  /** When this browser stops being trusted, if it just became so. */
  trustedDeviceExpiresAt?: string;
  /** How linking the waiting identity went, when the sign-in asked for it. */
  identityLink?: IdentityLinkOutcome;
}

/** A method being set up. The secret is shown once and never stored by the client. */
export interface MfaEnrollment {
  methodId: string;
  type: MfaMethodType;
  secret?: string;
  otpAuthUri?: string;
}

/** A browser the account trusts to skip the second factor until `expiresAt`. */
export interface TrustedDevice {
  id: string;
  name: string;
  /** The browser and system the device reported, as the server recorded it. */
  device: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
}

/** One entry of the account's security history. `kind` is the server's name for it. */
export interface SecurityEvent {
  id: string;
  kind: string;
  detail: string;
  ipAddress: string;
  device: string;
  createdAt: string;
}

/** The account's second-factor state, as the security settings show it. */
export interface AccountSecurity {
  /** The instance's policy: "optional", "admins", "everyone" or "cockpit". */
  requirement: string;
  /** A second factor is due at this account's sign-in. */
  mfaRequired: boolean;
  /** This session proved a second factor recently enough to change security. */
  freshMfa: boolean;
  /** How this session passed its second step, such as "totp" or "trusted_device". */
  mfaEvidence?: string;
  /** When this session passed its second step, if it did. */
  mfaCompletedAt?: string;
  methods: MfaMethod[];
  remainingRecoveryCodes: number;
  trustedDevices: TrustedDevice[];
  recentEvents: SecurityEvent[];
  trustedDeviceDays: number;
  emailCodeAvailable: boolean;
  /** The server can register and check passkeys: it has a public HTTPS address. */
  passkeyAvailable: boolean;
  /** Identities at providers this account signs in with. */
  identities: LinkedIdentity[];
  /** The providers the account can link itself to. */
  identityProviders: IdentityProvider[];
  /** False for an account made through a provider until it sets a password. */
  hasPassword: boolean;
}

/** An identity at a provider the account signs in with. */
export interface LinkedIdentity {
  id: string;
  /** The configured provider it was linked through; absent for older links. */
  providerId?: string;
  /** The provider's name, or its host when it is no longer configured. */
  name: string;
  createdAt: string;
}

export interface IdentityProvider {
  id: string;
  displayName: string;
}

/** One of the account's signed-in devices. */
export interface OwnSession {
  id: string;
  /** The user agent the session signed in with. */
  device: string;
  ipAddress: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** This browser's own session, which ends through signing out instead. */
  current: boolean;
}
