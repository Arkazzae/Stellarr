import type { UploadMediaMetadata } from "@/lib/media/probe";
import type { InboxNotification, NotificationPage } from "@/ports/notifications";

import type {
  AccountDetails,
  AccountImageKind,
  AccountPreferences,
  AccountUpdateInput,
  Attachment,
  Bootstrap,
  Channel,
  ChannelId,
  ChannelReadChanged,
  ChannelUpdateInput,
  DirectMessageHistoryPage,
  FriendRequestAnswer,
  JoinSoundLibrary,
  LoginInput,
  Message,
  MessageHistoryPage,
  MessageId,
  MessageIndexKind,
  MessageIndexPage,
  MessageReactionChanged,
  MessageSyncPage,
  NewServer,
  PasswordChangeAnswer,
  RegisterInput,
  Section,
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

/**
 * The HTTP surface the UI depends on. Adapters build the ports on top of this
 * client, so nothing above them knows about routes, headers or payload shapes.
 *
 * Authentication is an HttpOnly session cookie set by the server; the client
 * never reads or stores a token. Every method accepts an `AbortSignal` as its
 * last argument, except `logout`.
 */
export interface ApiClient {
  login(input: LoginInput, signal?: AbortSignal): Promise<User>;
  register(input: RegisterInput, signal?: AbortSignal): Promise<User>;
  requestPasswordReset(email: string, signal?: AbortSignal): Promise<void>;
  resetPassword(token: string, newPassword: string, signal?: AbortSignal): Promise<void>;
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
  changePassword(
    currentPassword: string,
    newPassword: string,
    signal?: AbortSignal,
  ): Promise<PasswordChangeAnswer>;
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
