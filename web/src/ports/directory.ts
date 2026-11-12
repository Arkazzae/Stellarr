import type {
  Channel,
  ChannelId,
  ChannelKind,
  NewServer,
  Section,
  Server,
  ServerBan,
  ServerMember,
  ServerPermission,
  ServerRole,
  UserId,
} from "@/lib/api/types";

import type { Unsubscribe } from "./chat";
import type { OpusProfileId } from "./voice";

export type { NewServer, Section };

/** The server, its channels and its people: what the rail renders. */
export interface DirectoryPort {
  getServer(): Server;
  listServers(): Server[];
  listChannels(): Channel[];
  listSections(): Section[];
  listPermissions(): ServerPermission[];
  onChanged(handler: () => void): Unsubscribe;
  /** Rail drag-and-drop: applied locally at once, persisted by the adapter. */
  reorderChannels(orderedIds: ChannelId[]): Promise<void>;
  /** Dragging section headers; same optimistic handling as channels. */
  reorderSections(orderedIds: string[]): Promise<void>;
  createServer(input: NewServer): Promise<Server>;
  discoverServers(): Promise<Server[]>;
  joinServer(serverId: string): Promise<Server>;
  joinInvite(code: string): Promise<Server>;
  /** Persists the active membership; the session owns the reload that follows. */
  selectServer(serverId: string): void;
}

/**
 * Server administration, as the settings modal uses it.
 *
 * `supported` says which panes this member may act in, from their effective
 * permissions. A pane without permission stays readable and says why.
 */
export interface ServerAdminPort {
  readonly supported: AdminSupport;

  updateServer(patch: ServerPatch): Promise<void>;
  uploadServerIcon(file: File): Promise<string>;
  removeServerIcon(): Promise<void>;

  /** One channel, from the cog on its rail row. Gated on `supported.channels`. */
  createChannel(input: NewChannel): Promise<void>;
  updateChannel(channelId: ChannelId, patch: ChannelPatch): Promise<void>;
  deleteChannel(channelId: ChannelId): Promise<void>;

  /**
   * Collapsible rail groups, gated as a family on `supported.sections`. A
   * section is only a display label over each channel's own global `Position`,
   * so there is no per-section reorder endpoint.
   */
  createSection(input: { name: string }): Promise<void>;
  updateSection(sectionId: string, patch: { name?: string }): Promise<void>;
  deleteSection(sectionId: string): Promise<void>;
  /** Moves a channel into a section, or out of one when `sectionId` is null. */
  assignChannelSection(channelId: ChannelId, sectionId: string | null): Promise<void>;

  /**
   * Per-role allow/deny narrowing for one channel or section. Gated on
   * `supported.roles`: it edits what a role grants, with the same authority as
   * the role editor.
   */
  listPermissionOverrides(
    targetType: PermissionTargetType,
    targetId: string,
  ): Promise<PermissionOverride[]>;
  setPermissionOverride(
    targetType: PermissionTargetType,
    targetId: string,
    roleId: string,
    patch: { allow: ServerPermission[]; deny: ServerPermission[] },
  ): Promise<PermissionOverride>;
  deletePermissionOverride(
    targetType: PermissionTargetType,
    targetId: string,
    roleId: string,
  ): Promise<void>;

  listRoles(): Promise<Role[]>;
  createRole(input: RoleInput): Promise<Role>;
  updateRole(roleId: string, patch: Partial<RoleInput>): Promise<Role>;
  deleteRole(roleId: string): Promise<void>;
  listMembers(): Promise<AdminMember[]>;
  assignRole(userId: UserId, roleId: string): Promise<void>;
  listInvites(): Promise<Invite[]>;
  revokeInvite(inviteId: string): Promise<void>;
  createInvite(): Promise<Invite>;
  sendInvite(inviteId: string, userId: UserId): Promise<void>;
  listBans(): Promise<Ban[]>;
  /**
   * Removes somebody from the server. They can return through an invite,
   * unlike `kickFromChannel`, which leaves their membership alone.
   */
  kick(userId: UserId): Promise<void>;
  /** Disconnects a member from one voice channel without removing membership. */
  kickFromChannel?(channelId: ChannelId, userId: UserId): Promise<void>;
  /** Moves a live voice seat to another public channel without recapturing media. */
  moveVoiceMember?(
    sourceChannelId: ChannelId,
    targetChannelId: ChannelId,
    userId: UserId,
  ): Promise<void>;
  /** Removes them and keeps them out. `reason` is shown in the bans list. */
  ban(userId: UserId, reason?: string): Promise<void>;
  unban(userId: UserId): Promise<void>;
  listAuditEntries(): Promise<AuditEntry[]>;
  listEmoji(): Promise<CustomEmoji[]>;
  uploadEmoji(shortcode: string, file: File): Promise<CustomEmoji>;
  deleteEmoji(emojiId: string): Promise<void>;

  getNotificationSettings(): Promise<NotificationSettings>;
  setNotificationSettings(patch: Partial<NotificationSettings>): Promise<void>;

  transferOwnership(userId: UserId): Promise<void>;
  deleteServer(): Promise<void>;
}

export interface AdminSupport {
  server: boolean;
  serverIcon: boolean;
  channels: boolean;
  roles: boolean;
  members: boolean;
  invites: boolean;
  emoji: boolean;
  soundboard: boolean;
  audit: boolean;
  bans: boolean;
  /**
   * Kicking and banning. Separate from `bans`, which covers only the list: a
   * server can show who is banned long before it lets anyone do the banning.
   */
  moderation: boolean;
  /** Whether rail sections can be created, renamed, reordered and assigned. */
  sections: boolean;
}

export type PermissionTargetType = "channel" | "section";

/** One role's allow/deny narrowing, scoped to a channel or section. */
export interface PermissionOverride {
  roleId: string;
  allow: ServerPermission[];
  deny: ServerPermission[];
}

export interface ServerPatch {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface NewChannel {
  name: string;
  kind: ChannelKind;
  sectionId?: string;
}

/**
 * What the channel dialog can change.
 *
 * A patch type because some channel settings are ahead of the wire contract:
 * the dialog can keep asking for them without the read-only fields looking
 * persisted.
 *
 * Screen-share quality is absent on purpose. It is a local sender choice, and
 * every profile is available in every voice channel.
 */
export interface ChannelPatch {
  name?: string;
  topic?: string;
  /** Text only. Seconds between messages from one person; 0 is off. */
  slowModeSeconds?: number;
  /** Hours of silence before the channel drops out of the rail; 0 is never. */
  hideAfterInactivityHours?: number;
  /** Voice only. The codec profile everyone in the channel is encoded with. */
  audioProfile?: OpusProfileId;
  /** Voice only. How many people may be in the call at once; 0 is no limit. */
  userLimit?: number;
}

export type Role = ServerRole;
export type AdminMember = ServerMember;
export type { ServerPermission };
export { SERVER_PERMISSION_VALUES } from "@/lib/api/types";

export interface RoleInput {
  name: string;
  /** Any CSS colour; the dot and the chip both read it. */
  color: string;
  permissions: ServerPermission[];
}

export interface Invite {
  id: string;
  url: string;
  createdByName: string;
  uses: number;
  /** null means unlimited. */
  maxUses: number | null;
  /** ISO 8601, or null when it never expires. */
  expiresAt: string | null;
}

export type Ban = ServerBan;

export interface AuditEntry {
  id: string;
  summary: string;
  at: string;
}

export interface CustomEmoji {
  id: string;
  shortcode: string;
  /** URL of the server-hosted emoji image. */
  glyph: string;
}

export interface NotificationSettings {
  allMessages: boolean;
  mentionsOnly: boolean;
  voiceJoinSound: boolean;
  mutedChannelIds: ChannelId[];
  serverMuted: boolean;
}
