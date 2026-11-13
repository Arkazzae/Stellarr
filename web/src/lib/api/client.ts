import type { UploadMediaMetadata } from "@/lib/media/probe";
import type { InboxNotification, NotificationPage } from "@/ports/notifications";

import { accountCalls } from "./calls/account";
import { channelCalls } from "./calls/channels";
import { libraryCalls } from "./calls/library";
import { memberCalls } from "./calls/members";
import { messageCalls } from "./calls/messages";
import { notificationCalls } from "./calls/notifications";
import { serverCalls } from "./calls/server";
import { securityCalls } from "./calls/security";
import { sessionCalls } from "./calls/session";
import { signInCalls } from "./calls/signIn";
import { socialCalls } from "./calls/social";
import type {
  AccountDetails,
  AccountSecurity,
  AuthResult,
  AccountImageKind,
  AccountPreferences,
  AccountUpdateInput,
  Attachment,
  Bootstrap,
  Channel,
  ChannelId,
  ChannelReadChanged,
  ChannelUpdateInput,
  ClientSettingsSection,
  ClientSettingsSnapshot,
  DirectMessageHistoryPage,
  FriendRequestAnswer,
  JoinSoundLibrary,
  LoginInput,
  Message,
  MfaChallenge,
  MfaCompletion,
  MfaEnrollment,
  MfaVerifyInput,
  OwnSession,
  MessageHistoryPage,
  MessageId,
  MessageIndexKind,
  MessageIndexPage,
  MessageReactionChanged,
  MessageSyncPage,
  NewServer,
  EmailChangeAnswer,
  EmailConfirmAnswer,
  PasswordChangeAnswer,
  RegisterInput,
  Section,
  SecurityEvent,
  SendMessageInput,
  Server,
  ServerBan,
  ServerMember,
  ServerPermission,
  ServerRole,
  SocialState,
  SoundboardSettings,
  SoundboardSnapshot,
  SoundboardSound,
  ThreadSummary,
  User,
} from "./types";

export { ACTIVE_SERVER_STORAGE_KEY } from "./transport";
export {
  parseChannelRead,
  parseEmbedsUpdate,
  parseMessage,
  parseMessageHistoryPage,
  parseMessageSyncPage,
  parseReactionChanged,
  parseServer,
  parseSoundboardSound,
  parseThreadSummary,
  parseUser,
} from "./parsers";

/**
 * The HTTP surface the UI depends on. Adapters build the ports on top of this
 * client, so nothing above them knows about routes, headers or payload shapes.
 *
 * Authentication is an HttpOnly session cookie set by the server; the client
 * never reads or stores a token. Every method accepts an `AbortSignal` as its
 * last argument, except `logout`.
 */
export interface ApiClient {
  needsServerSetup(signal?: AbortSignal): Promise<boolean>;
  login(input: LoginInput, signal?: AbortSignal): Promise<AuthResult>;
  register(input: RegisterInput, signal?: AbortSignal): Promise<AuthResult>;
  /** The challenge this browser left unfinished, after a reload or an OIDC redirect. */
  pendingChallenge(signal?: AbortSignal): Promise<MfaChallenge>;
  cancelChallenge(): Promise<void>;
  verifyChallenge(input: MfaVerifyInput, signal?: AbortSignal): Promise<MfaCompletion>;
  sendChallengeEmailCode(
    challengeId: string,
    methodId?: string,
    signal?: AbortSignal,
  ): Promise<{ retryAfterSeconds: number }>;
  startTotpEnrollment(challengeId: string, name: string, signal?: AbortSignal): Promise<MfaEnrollment>;
  confirmTotpEnrollment(
    input: { challengeId: string; methodId: string; code: string; name: string; rememberDevice?: boolean },
    signal?: AbortSignal,
  ): Promise<MfaCompletion>;
  startEmailEnrollment(
    challengeId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<{ retryAfterSeconds: number }>;
  confirmEmailEnrollment(
    input: { challengeId: string; code: string; name: string; rememberDevice?: boolean },
    signal?: AbortSignal,
  ): Promise<MfaCompletion>;
  /** Trades an operator's one-time recovery credential for a replacement-enrollment challenge. */
  redeemRecoveryCredential(credential: string, keepSignedIn?: boolean, signal?: AbortSignal): Promise<MfaChallenge>;
  /** The server's options for answering a pending second step with a passkey. */
  passkeyChallengeOptions(challengeId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  verifyPasskey(
    input: { challengeId: string; response: Record<string, unknown>; rememberDevice?: boolean },
    signal?: AbortSignal,
  ): Promise<MfaCompletion>;
  /** The server's options for creating a passkey during a setup. */
  startPasskeyEnrollment(challengeId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  confirmPasskeyEnrollment(
    input: { challengeId: string; name: string; response: Record<string, unknown>; rememberDevice?: boolean },
    signal?: AbortSignal,
  ): Promise<MfaCompletion>;
  /** Whether the server offers signing in with a passkey alone. */
  passkeySignInAvailable(signal?: AbortSignal): Promise<boolean>;
  passkeySignInOptions(signal?: AbortSignal): Promise<Record<string, unknown>>;
  signInWithPasskey(
    input: { response: Record<string, unknown>; keepSignedIn?: boolean },
    signal?: AbortSignal,
  ): Promise<AuthResult>;
  getAccountSecurity(signal?: AbortSignal): Promise<AccountSecurity>;
  listSecurityEvents(signal?: AbortSignal): Promise<SecurityEvent[]>;
  /**
   * Opens the setup of another method. Refused with 403 unless the session
   * proved a second factor recently, or, for a first method, the password.
   */
  startMfaEnrollment(password?: string, signal?: AbortSignal): Promise<MfaChallenge>;
  /** A fresh second-factor proof for a change to the account's security. */
  startMfaReverification(signal?: AbortSignal): Promise<MfaChallenge>;
  removeMfaMethod(methodId: string, password?: string): Promise<void>;
  regenerateRecoveryCodes(password?: string, signal?: AbortSignal): Promise<string[]>;
  revokeTrustedDevice(deviceId: string): Promise<void>;
  /** After the proof, the address the browser goes to, to link the account to the provider. */
  startIdentityLink(providerId: string, password?: string): Promise<string>;
  removeIdentity(identityId: string, password?: string): Promise<void>;
  listOwnSessions(signal?: AbortSignal): Promise<OwnSession[]>;
  /** Refused with 409 for the current session, which ends through logout. */
  revokeOwnSession(sessionId: string): Promise<void>;
  revokeOtherSessions(): Promise<void>;
  requestPasswordReset(email: string, signal?: AbortSignal): Promise<void>;
  resetPassword(token: string, newPassword: string, signal?: AbortSignal): Promise<void>;
  /** Spends the link from the new address; works signed out, on any device. */
  confirmEmailChange(token: string, signal?: AbortSignal): Promise<EmailConfirmAnswer>;
  logout(): Promise<void>;
  /**
   * Resolves to null for an anonymous visitor.
   *
   * `GET /api/session` is public and answers 200 with `{ "user": null }` when
   * nobody is signed in. A 401 is read as null too, so a client deployed
   * against an older API keeps working.
   */
  session(signal?: AbortSignal): Promise<User | null>;
  bootstrap(signal?: AbortSignal): Promise<Bootstrap>;
  listServers(signal?: AbortSignal): Promise<Server[]>;
  discoverServers(signal?: AbortSignal): Promise<Server[]>;
  createServer(input: NewServer, signal?: AbortSignal): Promise<Server>;
  joinServer(serverId: string, signal?: AbortSignal): Promise<Server>;
  joinServerInvite(code: string, signal?: AbortSignal): Promise<Server>;
  listMessages(
    channelId: ChannelId,
    options?: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<MessageHistoryPage>;
  syncMessages(
    channelId: ChannelId,
    after: string,
    signal?: AbortSignal,
  ): Promise<MessageSyncPage>;
  /** Complete thread catalogue for one text channel, newest activity first. */
  listThreads(channelId: ChannelId, signal?: AbortSignal): Promise<ThreadSummary[]>;
  /** The root and all replies, independent of the loaded transcript window. */
  getThread(
    channelId: ChannelId,
    rootId: MessageId,
    signal?: AbortSignal,
  ): Promise<Message[]>;
  listIndexedMessages(
    channelId: ChannelId,
    options: {
      kind: MessageIndexKind;
      query?: string;
      cursor?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<MessageIndexPage>;
  searchMessages(channelId: ChannelId, query: string, signal?: AbortSignal): Promise<Message[]>;
  sendMessage(
    channelId: ChannelId,
    input: SendMessageInput,
    signal?: AbortSignal,
  ): Promise<Message>;
  /**
   * Rewrites the text of a message; its attachments stay as they went out, so
   * a picture cannot be swapped after people reacted to it.
   *
   * Authors only. The server answers 404 for anyone else's message, which is
   * also what it answers for a message that does not exist, so probing cannot
   * reveal which ids are real.
   */
  editMessage(
    messageId: MessageId,
    content: string,
    signal?: AbortSignal,
  ): Promise<Message>;
  /** Deletes a message as its author or with the `manageMessages` permission. */
  deleteMessage(messageId: MessageId, signal?: AbortSignal): Promise<void>;
  /** Adds or removes this user's durable reaction, idempotently. */
  setMessageReaction(
    messageId: MessageId,
    emoji: string,
    added: boolean,
    signal?: AbortSignal,
  ): Promise<MessageReactionChanged>;
  markChannelRead(
    channelId: ChannelId,
    signal?: AbortSignal,
  ): Promise<ChannelReadChanged>;
  listNotifications(
    options?: { beforeSequence?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<NotificationPage>;
  markNotificationRead(
    notificationId: string,
    signal?: AbortSignal,
  ): Promise<InboxNotification>;
  /** Resolves to how many rows changed. */
  markAllNotificationsRead(signal?: AbortSignal): Promise<number>;
  deleteNotification(notificationId: string, signal?: AbortSignal): Promise<void>;
  /**
   * The channel's pinned messages, newest pin first.
   *
   * A read of its own rather than a filter over the transcript: a pin is
   * usually far above the last loaded page, so a derived list would grow as
   * the reader scrolls and stop being the list of pinned messages.
   */
  listPinnedMessages(
    channelId: ChannelId,
    signal?: AbortSignal,
  ): Promise<Message[]>;
  /**
   * Pins or unpins a message; requires `manageMessages`.
   *
   * Idempotent in both directions. It answers with the whole message, so the
   * caller never has to guess what the server decided `pinnedAt` should be.
   */
  setMessagePinned(
    messageId: MessageId,
    pinned: boolean,
    signal?: AbortSignal,
  ): Promise<Message>;
  uploadAttachment(
    file: File,
    metadata?: UploadMediaMetadata,
    signal?: AbortSignal,
  ): Promise<Attachment>;
  getAccount(signal?: AbortSignal): Promise<AccountDetails>;
  updateAccount(
    input: AccountUpdateInput,
    signal?: AbortSignal,
  ): Promise<AccountDetails>;
  updatePreferences(
    input: Partial<AccountPreferences>,
    signal?: AbortSignal,
  ): Promise<AccountPreferences>;
  /** Every sound this account may announce its arrivals with. */
  getJoinSoundLibrary(signal?: AbortSignal): Promise<JoinSoundLibrary>;
  /** The client's own settings the account keeps, by section. */
  getClientSettings(signal?: AbortSignal): Promise<ClientSettingsSnapshot>;
  /** Replaces one section of them whole. */
  saveClientSettings(
    section: ClientSettingsSection,
    value: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
  changePassword(
    currentPassword: string,
    newPassword: string,
    signal?: AbortSignal,
  ): Promise<PasswordChangeAnswer>;
  /** Mails a link to the new address; the address changes only when it is opened. */
  requestEmailChange(email: string, password: string, signal?: AbortSignal): Promise<EmailChangeAnswer>;
  uploadAccountImage(
    kind: AccountImageKind,
    file: File,
    signal?: AbortSignal,
  ): Promise<AccountDetails>;
  removeAccountImage(
    kind: AccountImageKind,
    signal?: AbortSignal,
  ): Promise<AccountDetails>;
  getSoundboard(signal?: AbortSignal): Promise<SoundboardSnapshot>;
  createSoundboardSound(
    input: {
      attachmentId: string;
      name: string;
      glyph: string;
      trimStartSeconds: number;
      trimEndSeconds: number;
    },
    signal?: AbortSignal,
  ): Promise<SoundboardSound>;
  updateSoundboardSound(
    soundId: string,
    patch: Partial<
      Pick<SoundboardSound, "name" | "glyph" | "trimStartSeconds" | "trimEndSeconds">
    >,
    signal?: AbortSignal,
  ): Promise<SoundboardSound>;
  deleteSoundboardSound(soundId: string, signal?: AbortSignal): Promise<void>;
  updateSoundboardSettings(
    patch: Partial<SoundboardSettings>,
    signal?: AbortSignal,
  ): Promise<SoundboardSettings>;
}

/** The operations only the persisted friends and direct-message adapter uses. */
export interface SocialApiClient {
  getSocialState(signal?: AbortSignal): Promise<SocialState>;
  sendFriendRequest(username: string, signal?: AbortSignal): Promise<FriendRequestAnswer>;
  acceptFriendRequest(requestId: string, signal?: AbortSignal): Promise<void>;
  deleteFriendRequest(requestId: string, signal?: AbortSignal): Promise<void>;
  removeFriend(userId: string, signal?: AbortSignal): Promise<void>;
  blockUser(userId: string, signal?: AbortSignal): Promise<void>;
  unblockUser(userId: string, signal?: AbortSignal): Promise<void>;
  openDirectConversation(userId: string, signal?: AbortSignal): Promise<string>;
  listDirectMessages(
    conversationId: string,
    options?: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<DirectMessageHistoryPage>;
  sendDirectMessage(
    conversationId: string,
    content: string,
    attachmentIds?: string[],
    clientMessageId?: string,
    signal?: AbortSignal,
  ): Promise<Message>;
  uploadAttachment(
    file: File,
    metadata?: UploadMediaMetadata,
    signal?: AbortSignal,
  ): Promise<Attachment>;
  markDirectConversationRead(conversationId: string, signal?: AbortSignal): Promise<void>;
}

/** Server administration: roles, members, channels, invites and the like. */
export interface AdminApiClient {
  updateServer(
    patch: { name?: string; description?: string; isPublic?: boolean },
    signal?: AbortSignal,
  ): Promise<Server>;
  uploadServerIcon(file: File, signal?: AbortSignal): Promise<string>;
  removeServerIcon(signal?: AbortSignal): Promise<void>;
  listRoles(signal?: AbortSignal): Promise<ServerRole[]>;
  createRole(
    input: Pick<ServerRole, "name" | "color" | "permissions">,
    signal?: AbortSignal,
  ): Promise<ServerRole>;
  updateRole(
    roleId: string,
    patch: Partial<Pick<ServerRole, "name" | "color" | "permissions">>,
    signal?: AbortSignal,
  ): Promise<ServerRole>;
  deleteRole(roleId: string, signal?: AbortSignal): Promise<void>;
  createChannel(
    input: { name: string; kind: "text" | "voice"; sectionId?: string },
    signal?: AbortSignal,
  ): Promise<Channel>;
  listServerMembers(signal?: AbortSignal): Promise<ServerMember[]>;
  assignRole(userId: string, roleId: string, signal?: AbortSignal): Promise<void>;
  listBans(signal?: AbortSignal): Promise<ServerBan[]>;
  kickMember(userId: string, signal?: AbortSignal): Promise<void>;
  kickVoiceMember(
    channelId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  moveVoiceMember(
    sourceChannelId: string,
    targetChannelId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  updateChannel(
    channelId: string,
    patch: ChannelUpdateInput,
    signal?: AbortSignal,
  ): Promise<Channel>;
  deleteChannel(channelId: string, signal?: AbortSignal): Promise<void>;
  reorderChannels(channelIds: string[], signal?: AbortSignal): Promise<void>;
  createSection(input: { name: string }, signal?: AbortSignal): Promise<Section>;
  updateSection(
    sectionId: string,
    patch: { name?: string },
    signal?: AbortSignal,
  ): Promise<Section>;
  deleteSection(sectionId: string, signal?: AbortSignal): Promise<void>;
  reorderSections(sectionIds: string[], signal?: AbortSignal): Promise<void>;
  assignChannelSection(
    channelId: string,
    sectionId: string | null,
    signal?: AbortSignal,
  ): Promise<void>;
  listPermissionOverrides(
    targetType: PermissionTargetType,
    targetId: string,
    signal?: AbortSignal,
  ): Promise<PermissionOverride[]>;
  setPermissionOverride(
    targetType: PermissionTargetType,
    targetId: string,
    roleId: string,
    patch: { allow: ServerPermission[]; deny: ServerPermission[] },
    signal?: AbortSignal,
  ): Promise<PermissionOverride>;
  deletePermissionOverride(
    targetType: PermissionTargetType,
    targetId: string,
    roleId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  banMember(userId: string, reason?: string, signal?: AbortSignal): Promise<void>;
  unbanMember(userId: string, signal?: AbortSignal): Promise<void>;
  listEmoji(signal?: AbortSignal): Promise<ApiCustomEmoji[]>;
  uploadEmoji(
    shortcode: string,
    file: File,
    signal?: AbortSignal,
  ): Promise<ApiCustomEmoji>;
  deleteEmoji(emojiId: string, signal?: AbortSignal): Promise<void>;
  listInvites(signal?: AbortSignal): Promise<ApiInvite[]>;
  createInvite(signal?: AbortSignal): Promise<ApiInvite>;
  revokeInvite(inviteId: string, signal?: AbortSignal): Promise<void>;
  sendInvite(inviteId: string, userId: string, signal?: AbortSignal): Promise<void>;
  listAuditEntries(signal?: AbortSignal): Promise<ApiAuditEntry[]>;
  getNotificationSettings(signal?: AbortSignal): Promise<ApiNotificationSettings>;
  setNotificationSettings(
    patch: Partial<ApiNotificationSettings>,
    signal?: AbortSignal,
  ): Promise<ApiNotificationSettings>;
  transferServer(userId: string, signal?: AbortSignal): Promise<void>;
  deleteServer(signal?: AbortSignal): Promise<void>;
}

export type PermissionTargetType = "channel" | "section";

export interface PermissionOverride {
  roleId: string;
  allow: ServerPermission[];
  deny: ServerPermission[];
}

export interface ApiCustomEmoji {
  id: string;
  shortcode: string;
  glyph: string;
}

export interface ApiInvite {
  id: string;
  url: string;
  createdByName: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
}

export interface ApiAuditEntry {
  id: string;
  summary: string;
  at: string;
}

export interface ApiNotificationSettings {
  allMessages: boolean;
  mentionsOnly: boolean;
  voiceJoinSound: boolean;
  mutedChannelIds: string[];
  serverMuted: boolean;
}

/** The client over HTTP: every request group joined into one object. */
export function createHttpApiClient(): ApiClient & SocialApiClient & AdminApiClient {
  return {
    ...sessionCalls(),
    ...signInCalls(),
    ...securityCalls(),
    ...serverCalls(),
    ...memberCalls(),
    ...channelCalls(),
    ...libraryCalls(),
    ...messageCalls(),
    ...notificationCalls(),
    ...accountCalls(),
    ...socialCalls(),
  };
}
