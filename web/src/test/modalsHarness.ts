import { vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";
import { DEFAULT_SETTINGS } from "@/lib/voice/settings";
import type { Channel, ServerAdminPort } from "@/ports";
import type {
  AccountValue,
  DirectoryValue,
  EmojiValue,
  FriendsValue,
  UiValue,
  VoiceValue,
} from "@/state/hooks";

import { fakeAdminPort } from "./adminPort";

/**
 * The slice of each state hook that `ModalsContainer` reads, with the dialogs'
 * own `useLanguage` alongside. A test mocks `@/state/hooks` with
 * `hooksModule()` and then edits `harness` before rendering; every hook hands
 * back the same object on every render, as the real providers do.
 */
export interface Harness {
  ports: {
    admin: ServerAdminPort;
    directory: { reorderSections: ReturnType<typeof vi.fn> };
    soundboard: Record<"updateSettings" | "create" | "update" | "delete", ReturnType<typeof vi.fn>>;
    voiceSettings: {
      subscribe: () => () => void;
      getSnapshot: () => typeof DEFAULT_SETTINGS;
      update: ReturnType<typeof vi.fn>;
    };
  };
  directory: Pick<
    DirectoryValue,
    | "server"
    | "servers"
    | "serverMark"
    | "channels"
    | "sections"
    | "members"
    | "people"
    | "canAccessServerSettings"
    | "canManageServer"
    | "canManageChannels"
  > &
    Record<"selectServer" | "createServer" | "discoverServers" | "joinServer" | "joinInvite", ReturnType<typeof vi.fn>>;
  ui: Pick<
    UiValue,
    "modal" | "channelSettingsId" | "sectionSettingsId" | "newChannelKind"
  > &
    Record<
      | "openModal"
      | "closeModal"
      | "openServer"
      | "openChannelSettings"
      | "openCreateChannel"
      | "openSectionSettings"
      | "openCreateSection",
      ReturnType<typeof vi.fn>
    >;
  voice: Pick<VoiceValue, "sounds" | "soundboard">;
  account: Pick<AccountValue, "preferences"> & {
    setPreferences: ReturnType<typeof vi.fn>;
  };
  friends: Pick<FriendsValue, "friends">;
  session: { reload: ReturnType<typeof vi.fn> };
  emoji: Pick<EmojiValue, "emoji"> & { refresh: ReturnType<typeof vi.fn> };
  language: { locale: "pl"; t: (key: MessageKey, values?: Record<string, string | number>) => string };
}

export const TEXT_CHANNEL: Channel = {
  id: "ch-general",
  name: "general",
  kind: "text",
  topic: "Everything and nothing.",
  slowModeSeconds: 0,
  hideAfterInactivityHours: 0,
};

export const VOICE_CHANNEL: Channel = {
  id: "ch-salon",
  name: "Salon",
  kind: "voice",
  userLimit: 0,
  hideAfterInactivityHours: 0,
};

function freshHarness(): Harness {
  const voiceSettings = { ...DEFAULT_SETTINGS };
  const server = { id: "srv-orbit", name: "Orbit", createdAt: "2026-01-01T00:00:00.000Z" };
  return {
    ports: {
      admin: fakeAdminPort(),
      directory: { reorderSections: vi.fn(async () => {}) },
      soundboard: {
        updateSettings: vi.fn(async () => {}),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      voiceSettings: {
        subscribe: () => () => {},
        getSnapshot: () => voiceSettings,
        update: vi.fn(),
      },
    },
    directory: {
      server,
      servers: [server],
      serverMark: "OR",
      channels: [TEXT_CHANNEL, VOICE_CHANNEL],
      sections: [],
      members: [],
      people: [],
      canAccessServerSettings: true,
      canManageServer: true,
      canManageChannels: true,
      selectServer: vi.fn(),
      createServer: vi.fn(),
      discoverServers: vi.fn(async () => []),
      joinServer: vi.fn(),
      joinInvite: vi.fn(),
    },
    ui: {
      modal: null,
      channelSettingsId: null,
      sectionSettingsId: null,
      newChannelKind: null,
      openModal: vi.fn(),
      closeModal: vi.fn(),
      openServer: vi.fn(),
      openChannelSettings: vi.fn(),
      openCreateChannel: vi.fn(),
      openSectionSettings: vi.fn(),
      openCreateSection: vi.fn(),
    },
    voice: {
      sounds: [],
      soundboard: {
        sounds: [],
        settings: { everyoneCanPlay: true, rateLimited: true },
        canManage: false,
        supported: false,
        loading: false,
        error: null,
      },
    },
    account: {
      preferences: { mutedChannelIds: [] } as unknown as AccountValue["preferences"],
      setPreferences: vi.fn(async () => {}),
    },
    friends: { friends: [] },
    session: { reload: vi.fn() },
    emoji: { emoji: [], refresh: vi.fn(async () => {}) },
    language: { locale: "pl", t: (key, values) => translateMessage("pl", key, values) },
  };
}

export const harness: Harness = freshHarness();

/** Gives every test its own spies and a server with nothing in it. */
export function resetHarness(): void {
  Object.assign(harness, freshHarness());
}

/** The factory for `vi.mock("@/state/hooks", ...)`. */
export function hooksModule() {
  return {
    usePorts: () => harness.ports,
    useDirectory: () => harness.directory,
    useUi: () => harness.ui,
    useVoice: () => harness.voice,
    useAccount: () => harness.account,
    useFriends: () => harness.friends,
    useSession: () => harness.session,
    useEmoji: () => harness.emoji,
    useLanguage: () => harness.language,
  };
}
