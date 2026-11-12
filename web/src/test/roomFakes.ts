import { vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import type {
  ChatValue,
  DirectoryValue,
  LanguageValue,
  UiValue,
  VoiceValue,
} from "@/state/hooks";

/**
 * The state a room container reads, as plain records with every action a spy.
 *
 * Each fake carries only the members the room containers touch, and says so by
 * casting: a test that reaches for another member fails loudly on `undefined`
 * rather than quietly on a made-up default.
 */

/** One translator for every test, so its identity never changes between renders. */
export const t = (key: MessageKey, values?: MessageValues): string =>
  translateMessage("pl", key, values);

export function fakeLanguage(overrides: Partial<LanguageValue> = {}): LanguageValue {
  return {
    locale: "pl",
    t,
    chatTranslationEnabled: false,
    chatAutoTranslateEnabled: false,
    chatTranslationTargetLanguage: "en",
    ...overrides,
  } as unknown as LanguageValue;
}

export function fakeChat(overrides: Partial<ChatValue> = {}): ChatValue {
  return {
    channelId: "ch-general",
    sections: [],
    thread: null,
    loading: false,
    loadingOlder: false,
    hasOlder: false,
    typingNames: [],
    chips: [],
    pinned: [],
    pinnedLoading: false,
    pinError: null,
    replyingTo: null,
    editing: null,
    ownSendToken: 0,
    firstUnreadGroupId: null,
    send: vi.fn(async () => {}),
    sendVoice: vi.fn(async () => {}),
    sendGif: vi.fn(async () => {}),
    attach: vi.fn(),
    retryChip: vi.fn(),
    removeChip: vi.fn(),
    reorderChips: vi.fn(),
    notifyTyping: vi.fn(),
    loadOlder: vi.fn(),
    react: vi.fn(),
    runAction: vi.fn(),
    saveEdit: vi.fn(async () => {}),
    cancelEdit: vi.fn(),
    cancelReply: vi.fn(),
    closeThread: vi.fn(),
    revealMessage: vi.fn(),
    ...overrides,
  } as unknown as ChatValue;
}

export function fakeDirectory(overrides: Partial<DirectoryValue> = {}): DirectoryValue {
  return {
    channels: [],
    textChannels: [{ id: "ch-general", name: "general", kind: "text", topic: "Anything." }],
    members: [],
    canManageServer: false,
    canManageMessages: false,
    channelName: () => "",
    ...overrides,
  } as unknown as DirectoryValue;
}

export function fakeUi(overrides: Partial<UiValue> = {}): UiValue {
  return {
    roomView: "text",
    activeTextChannelId: "ch-general",
    channelPanel: null,
    channelPanelTab: "pinned",
    rosterOpen: false,
    railOpen: false,
    cinema: false,
    toggleRoster: vi.fn(),
    toggleRail: vi.fn(),
    toggleChannelPanel: vi.fn(),
    showChannelPanelTab: vi.fn(),
    closeChannelPanel: vi.fn(),
    closeDrawers: vi.fn(),
    toggleCinema: vi.fn(),
    openModal: vi.fn(),
    joinVoiceChannel: vi.fn(),
    leaveCall: vi.fn(),
    ...overrides,
  } as unknown as UiValue;
}

export function fakeVoice(overrides: Partial<VoiceValue> = {}): VoiceValue {
  return {
    state: { connection: "idle", muted: false, cameraPending: false },
    call: null,
    channelId: null,
    problem: null,
    people: [],
    share: null,
    localShare: false,
    cameraStreams: new Map(),
    participantVolumes: new Map(),
    participantGates: new Map(),
    participantSuppressions: new Map(),
    cameraSupported: true,
    sounds: [],
    soundboardEnabled: false,
    join: vi.fn(),
    leave: vi.fn(async () => {}),
    reconnect: vi.fn(),
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    toggleShare: vi.fn(),
    watchShare: vi.fn(),
    stopWatchingShare: vi.fn(),
    playSound: vi.fn(),
    setParticipantVolume: vi.fn(),
    setParticipantGate: vi.fn(),
    setParticipantSuppression: vi.fn(),
    ...overrides,
  } as unknown as VoiceValue;
}
