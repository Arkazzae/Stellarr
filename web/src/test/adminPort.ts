import { vi } from "vitest";

import type { AdminSupport, ServerAdminPort } from "@/ports";

export const ALL_SUPPORTED: AdminSupport = {
  server: true,
  serverIcon: true,
  channels: true,
  roles: true,
  members: true,
  invites: true,
  emoji: true,
  soundboard: true,
  audit: true,
  bans: true,
  moderation: true,
  sections: true,
};

export const NONE_SUPPORTED: AdminSupport = Object.fromEntries(
  Object.keys(ALL_SUPPORTED).map((key) => [key, false]),
) as unknown as AdminSupport;

/**
 * A server admin port that supports everything and answers every call with an
 * empty success. A test overrides only the calls it is about.
 */
export function fakeAdminPort(overrides: Partial<ServerAdminPort> = {}): ServerAdminPort {
  return {
    supported: ALL_SUPPORTED,
    updateServer: vi.fn(async () => {}),
    uploadServerIcon: vi.fn(async () => "/assets/icon"),
    removeServerIcon: vi.fn(async () => {}),
    createChannel: vi.fn(async () => {}),
    updateChannel: vi.fn(async () => {}),
    deleteChannel: vi.fn(async () => {}),
    createSection: vi.fn(async () => {}),
    updateSection: vi.fn(async () => {}),
    deleteSection: vi.fn(async () => {}),
    assignChannelSection: vi.fn(async () => {}),
    listPermissionOverrides: vi.fn(async () => []),
    setPermissionOverride: vi.fn(async (_type, _id, roleId, patch) => ({ roleId, ...patch })),
    deletePermissionOverride: vi.fn(async () => {}),
    listRoles: vi.fn(async () => []),
    createRole: vi.fn(async () => {
      throw new Error("createRole is not stubbed");
    }),
    updateRole: vi.fn(async () => {
      throw new Error("updateRole is not stubbed");
    }),
    deleteRole: vi.fn(async () => {}),
    listMembers: vi.fn(async () => []),
    assignRole: vi.fn(async () => {}),
    listInvites: vi.fn(async () => []),
    revokeInvite: vi.fn(async () => {}),
    createInvite: vi.fn(async () => {
      throw new Error("createInvite is not stubbed");
    }),
    sendInvite: vi.fn(async () => {}),
    listBans: vi.fn(async () => []),
    kick: vi.fn(async () => {}),
    ban: vi.fn(async () => {}),
    unban: vi.fn(async () => {}),
    listAuditEntries: vi.fn(async () => []),
    listEmoji: vi.fn(async () => []),
    uploadEmoji: vi.fn(async () => {
      throw new Error("uploadEmoji is not stubbed");
    }),
    deleteEmoji: vi.fn(async () => {}),
    getNotificationSettings: vi.fn(async () => ({
      allMessages: false,
      mentionsOnly: true,
      voiceJoinSound: true,
      mutedChannelIds: [],
      serverMuted: false,
    })),
    setNotificationSettings: vi.fn(async () => {}),
    transferOwnership: vi.fn(async () => {}),
    deleteServer: vi.fn(async () => {}),
    ...overrides,
  };
}
