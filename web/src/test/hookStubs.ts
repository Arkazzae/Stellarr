import { vi } from "vitest";

import type { Ports } from "@/ports";
import type {
  AccountValue,
  ChatValue,
  DirectoryValue,
  EmojiValue,
  FriendsValue,
  ProfileValue,
  SessionValue,
  UiValue,
  VoiceValue,
} from "@/state/hooks";
import { useLanguage } from "@/state/LanguageProvider";

/**
 * Replaces `@/state/hooks` for container tests, so a container can be rendered
 * against hand-written state without composing the providers:
 *
 *     vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);
 *
 * `stubs` holds what each hook returns. The defaults describe an empty server
 * with one signed-in user; a test patches the pieces it cares about with
 * `setStubs` and calls `resetStubs` between tests.
 */
export interface HookStubs {
  account: AccountValue;
  chat: ChatValue;
  directory: DirectoryValue;
  emoji: EmojiValue;
  friends: FriendsValue;
  ports: Ports;
  profile: ProfileValue;
  session: SessionValue;
  ui: UiValue;
  voice: VoiceValue;
}

/** The stores the containers read are far wider than any one test needs. */
function stub<T>(members: object): T {
  return members as T;
}

/** One object for the whole run: `useSyncExternalStore` needs a stable snapshot. */
const VOICE_SETTINGS = { soundboardVolume: 50, noiseSuppression: "off" };

function defaults(): HookStubs {
  return {
    account: stub<AccountValue>({
      account: { customStatus: "" },
      preferences: {
        desktopNotifications: true,
        developerMode: false,
        mutedChannelIds: [],
      },
      supported: { profile: true },
      update: vi.fn(async () => {}),
      setPreferences: vi.fn(async () => {}),
    }),
    chat: stub<ChatValue>({
      thread: null,
      threadsByChannel: {},
      openingThreadId: null,
      openThread: vi.fn(),
      closeThread: vi.fn(),
      unreadByChannel: {},
      markChannelRead: vi.fn(),
    }),
    directory: stub<DirectoryValue>({
      server: { id: "srv-orbit", name: "Orbit" },
      servers: [],
      textChannels: [],
      voiceChannels: [],
      sections: [],
      members: [],
      people: [],
      inVoice: [],
      canAccessServerSettings: false,
      canManageServer: false,
      canManageChannels: false,
      canModerateMembers: false,
      canManageBans: false,
      reorderChannelGroup: vi.fn(async () => {}),
      selectServer: vi.fn(),
    }),
    emoji: stub<EmojiValue>({ emoji: [] }),
    friends: stub<FriendsValue>({
      friends: [],
      requests: [],
      blocked: [],
      conversations: [],
      incoming: 0,
      unread: 0,
      messagePerson: vi.fn(),
      callConversation: vi.fn(),
      declineCall: vi.fn(),
      addFriend: vi.fn(async () => "sent"),
      accept: vi.fn(),
      decline: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn(),
      block: vi.fn(),
      unblock: vi.fn(),
    }),
    ports: stub<Ports>({
      admin: {
        supported: { channels: false, moderation: false, sections: false },
        kick: vi.fn(async () => {}),
        ban: vi.fn(async () => {}),
        deleteChannel: vi.fn(async () => {}),
        assignChannelSection: vi.fn(async () => {}),
        listMembers: vi.fn(async () => []),
        listRoles: vi.fn(async () => []),
      },
      voiceSettings: {
        getSnapshot: () => VOICE_SETTINGS,
        subscribe: () => () => {},
        update: vi.fn(),
      },
    }),
    profile: stub<ProfileValue>({ open: null, toggle: vi.fn(), close: vi.fn() }),
    session: stub<SessionValue>({
      user: { id: "u-maja", username: "maja", displayName: "Maja", presence: "online" },
      presence: "online",
      presenceSupported: true,
      setPresence: vi.fn(),
      reload: vi.fn(),
      logout: vi.fn(async () => {}),
    }),
    ui: stub<UiValue>({
      space: "server",
      activeChannelId: null,
      activeDmId: null,
      railOpen: false,
      serversOpen: false,
      rosterOpen: true,
      setRailOpen: vi.fn(),
      setServersOpen: vi.fn(),
      setRosterOpen: vi.fn(),
      toggleServers: vi.fn(),
      openModal: vi.fn(),
      openChannelSettings: vi.fn(),
      openCreateChannel: vi.fn(),
      openSectionSettings: vi.fn(),
      openFriends: vi.fn(),
      openDm: vi.fn(),
      openServer: vi.fn(),
      setFriendsTab: vi.fn(),
      selectTextChannel: vi.fn(),
      joinVoiceChannel: vi.fn(),
      leaveCall: vi.fn(),
      returnToChannel: vi.fn(),
    }),
    voice: stub<VoiceValue>({
      call: null,
      channelId: null,
      sounds: [],
      soundboardEnabled: false,
      cameraSupported: false,
      applySpeaking: vi.fn((people: unknown[]) => people),
      participantVolumes: new Map(),
      participantGates: new Map(),
      participantSuppressions: new Map(),
      setParticipantVolume: vi.fn(),
      setParticipantGate: vi.fn(),
      setParticipantSuppression: vi.fn(),
      toggleMute: vi.fn(),
      toggleDeafen: vi.fn(),
      toggleCamera: vi.fn(),
      toggleShare: vi.fn(),
      playSound: vi.fn(),
    }),
  };
}

export const stubs: HookStubs = defaults();

/** Back to the defaults, with fresh spies. */
export function resetStubs(): void {
  Object.assign(stubs, defaults());
}

/** Merges members into the named stores; the rest of each store is kept. */
export function setStubs(patch: {
  [K in keyof HookStubs]?: Partial<HookStubs[K]>;
}): void {
  for (const key of Object.keys(patch) as (keyof HookStubs)[]) {
    stubs[key] = { ...stubs[key], ...patch[key] } as never;
  }
}

export const hooksModule = {
  useAccount: () => stubs.account,
  useChat: () => stubs.chat,
  useDirectory: () => stubs.directory,
  useEmoji: () => stubs.emoji,
  useFriends: () => stubs.friends,
  usePorts: () => stubs.ports,
  useProfile: () => stubs.profile,
  useSession: () => stubs.session,
  useUi: () => stubs.ui,
  useVoice: () => stubs.voice,
  useLanguage,
};
