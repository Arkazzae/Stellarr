import type { AdminApiClient } from "@/lib/api/client";
import type { Channel, Section, Server, ServerPermission } from "@/lib/api/types";
import type { AdminSupport, ServerAdminPort } from "@/ports";

/**
 * `ServerAdminPort` over the admin endpoints.
 *
 * The adapter holds no server state. Each `on*` callback hands the server's
 * answer to whoever owns the directory, and `getPermissions` is read on every
 * access so a role change takes effect without rebuilding the adapter.
 */
export function createServerAdminAdapter(
  api: AdminApiClient,
  getPermissions: () => readonly ServerPermission[],
  onServerIconChanged: (iconUrl: string | undefined) => void,
  onChannelChanged?: (channelId: string, patch: Partial<Channel>) => void,
  onServerChanged?: (server: Server) => void,
  onChannelCreated?: (channel: Channel) => void,
  onChannelDeleted?: (channelId: string) => void,
  onSectionCreated?: (section: Section) => void,
  onSectionChanged?: (section: Section) => void,
  onSectionDeleted?: (sectionId: string) => void,
): ServerAdminPort {
  const can = (permission: ServerPermission): boolean =>
    getPermissions().includes(permission);

  return {
    get supported(): AdminSupport {
      const manageServer = can("manageServer");
      const manageChannels = can("manageChannels");
      const manageBans = can("manageBans");
      return {
        server: manageServer,
        serverIcon: manageServer,
        // Stored by the server, but message delivery does not read it yet.
        notifications: false,
        channels: manageChannels,
        sections: manageChannels,
        roles: can("manageRoles"),
        members: can("manageMembers"),
        invites: manageServer,
        emoji: manageServer,
        soundboard: manageServer,
        moderation: can("moderateMembers") || manageBans,
        bans: manageBans,
        audit: can("viewAuditLog"),
      };
    },

    async updateServer(patch) {
      const server = await api.updateServer(patch);
      onServerChanged?.(server);
    },
    async uploadServerIcon(file) {
      const iconUrl = await api.uploadServerIcon(file);
      onServerIconChanged(iconUrl);
      return iconUrl;
    },
    async removeServerIcon() {
      await api.removeServerIcon();
      onServerIconChanged(undefined);
    },

    async createChannel(input) {
      const channel = await api.createChannel(input);
      onChannelCreated?.(channel);
    },
    async updateChannel(channelId, patch) {
      const channel = await api.updateChannel(channelId, patch);
      onChannelChanged?.(channelId, channel);
    },
    async deleteChannel(channelId) {
      await api.deleteChannel(channelId);
      onChannelDeleted?.(channelId);
    },

    async createSection(input) {
      const section = await api.createSection(input);
      onSectionCreated?.(section);
    },
    async updateSection(sectionId, patch) {
      const section = await api.updateSection(sectionId, patch);
      onSectionChanged?.(section);
    },
    async deleteSection(sectionId) {
      await api.deleteSection(sectionId);
      onSectionDeleted?.(sectionId);
    },
    async assignChannelSection(channelId, sectionId) {
      await api.assignChannelSection(channelId, sectionId);
      onChannelChanged?.(channelId, { sectionId: sectionId ?? undefined });
    },

    listPermissionOverrides: (type, id) => api.listPermissionOverrides(type, id),
    setPermissionOverride: (type, id, roleId, patch) =>
      api.setPermissionOverride(type, id, roleId, patch),
    deletePermissionOverride: (type, id, roleId) =>
      api.deletePermissionOverride(type, id, roleId),

    listRoles: () => api.listRoles(),
    createRole: (input) => api.createRole(input),
    updateRole: (roleId, patch) => api.updateRole(roleId, patch),
    deleteRole: (roleId) => api.deleteRole(roleId),
    listMembers: () => api.listServerMembers(),
    assignRole: (userId, roleId) => api.assignRole(userId, roleId),

    listInvites: () => api.listInvites(),
    createInvite: () => api.createInvite(),
    revokeInvite: (inviteId) => api.revokeInvite(inviteId),
    sendInvite: (inviteId, userId) => api.sendInvite(inviteId, userId),

    // The list is not readable without the permission; ask only when allowed.
    listBans: () => (can("manageBans") ? api.listBans() : Promise.resolve([])),
    kick: (userId) => api.kickMember(userId),
    kickFromChannel: (channelId, userId) => api.kickVoiceMember(channelId, userId),
    moveVoiceMember: (sourceChannelId, targetChannelId, userId) =>
      api.moveVoiceMember(sourceChannelId, targetChannelId, userId),
    ban: (userId, reason) => api.banMember(userId, reason),
    unban: (userId) => api.unbanMember(userId),

    listAuditEntries: () => api.listAuditEntries(),
    listEmoji: () => api.listEmoji(),
    uploadEmoji: (shortcode, file) => api.uploadEmoji(shortcode, file),
    deleteEmoji: (emojiId) => api.deleteEmoji(emojiId),

    getNotificationSettings: () => api.getNotificationSettings(),
    async setNotificationSettings(patch) {
      await api.setNotificationSettings(patch);
    },

    transferOwnership: (userId) => api.transferServer(userId),
    deleteServer: () => api.deleteServer(),
  };
}
