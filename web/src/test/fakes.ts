import { vi } from "vitest";
import type { ApiClient } from "@/lib/api/client";
import type { Bootstrap, Channel, Presence, Server, User } from "@/lib/api/types";
import { ChangeNotifier, Emitter } from "@/lib/realtime/emitter";
import type {
  MediaSignal,
  RealtimeClient,
  RealtimeEventMap,
  RealtimeEventName,
  RealtimeStatus,
  VoiceSignal,
} from "@/lib/realtime/types";
import type { BrowserMediaSignalKind } from "@/lib/rtc/protocol";
import { IDLE_VOICE_STATE, type VoiceClient, type VoiceState } from "@/lib/voice/types";
import type { VoiceSettings } from "@/lib/voice/settings";

export const TEXT_CHANNEL: Channel = {
  id: "ch-general",
  name: "general",
  kind: "text",
  topic: "Wszystko i nic.",
};

export const VOICE_CHANNEL: Channel = {
  id: "ch-salon",
  name: "Salon",
  kind: "voice",
};

export const SERVER: Server = { id: "srv-orbit", name: "Orbit" };

export const SELF: User = {
  id: "u-maja",
  username: "maja",
  displayName: "Maja",
  presence: "online",
};

export const BOOTSTRAP: Bootstrap = {
  user: SELF,
  server: SERVER,
  servers: [SERVER],
  channels: [TEXT_CHANNEL, VOICE_CHANNEL],
  sections: [],
  members: [SELF],
  permissions: [],
  messages: [],
};

const ACCOUNT = {
  id: SELF.id,
  username: SELF.username,
  displayName: SELF.displayName,
  createdAt: "2026-01-01T00:00:00.000Z",
  customStatus: "",
  bio: "",
  pronouns: "",
  preferences: {
    desktopNotifications: true,
    emailNotifications: false,
    pushNotifications: false,
    mentionsOnly: true,
    messageSound: true,
    joinLeaveSound: true,
    allowDirectMessages: true,
    allowFriendRequests: true,
    showPresence: true,
    developerMode: false,
    reducedMotion: false,
    mutedChannelIds: [],
    vadSensitivity: 60,
    joinSoundId: null,
  },
};

export function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    login: vi.fn(async () => SELF),
    register: vi.fn(async () => SELF),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    session: vi.fn(async () => null),
    bootstrap: vi.fn(async () => BOOTSTRAP),
    listServers: vi.fn(async () => [SERVER]),
    discoverServers: vi.fn(async () => []),
    createServer: vi.fn(async (input) => ({ id: "server-new", ...input })),
    joinServer: vi.fn(async () => SERVER),
    joinServerInvite: vi.fn(async () => SERVER),
    listMessages: vi.fn(async () => ({ messages: [], nextCursor: null, syncCursor: "0" })),
    syncMessages: vi.fn(async (_channelId, after) => ({
      changes: [],
      nextCursor: after,
      hasMore: false,
      resetRequired: false,
    })),
    listThreads: vi.fn(async () => []),
    getThread: vi.fn(async () => []),
    listIndexedMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    searchMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async (channelId, input) => ({
      id: "m-new",
      channelId,
      author: { id: SELF.id, displayName: SELF.displayName },
      content: input.content,
      attachments: [],
      embeds: [],
      createdAt: new Date("2026-01-01T19:00:00Z").toISOString(),
    })),
    markChannelRead: vi.fn(async (channelId) => ({
      channelId,
      lastReadAt: new Date("2026-01-01T19:01:00Z").toISOString(),
    })),
    listNotifications: vi.fn(async () => ({
      items: [],
      nextBeforeSequence: null,
      unreadCount: 0,
      lastSequence: 0,
    })),
    markNotificationRead: vi.fn(async (notificationId) => ({
      id: notificationId,
      sequence: 1,
      title: "Notification",
      body: "Notification body",
      tone: "info" as const,
      source: {
        type: "sdk" as const,
        packageId: "dev.stellarr.test",
        packageName: "Test",
        moduleId: "test",
        moduleName: "Test",
      },
      createdAt: "2026-01-01T19:00:00Z",
      readAt: "2026-01-01T19:01:00Z",
    })),
    markAllNotificationsRead: vi.fn(async () => 0),
    deleteNotification: vi.fn(async () => {}),
    editMessage: vi.fn(async (messageId: string, content: string) => ({
      id: messageId,
      channelId: TEXT_CHANNEL.id,
      author: { id: SELF.id, displayName: SELF.displayName },
      content,
      attachments: [],
      embeds: [],
      createdAt: new Date("2026-01-01T19:00:00Z").toISOString(),
      editedAt: new Date("2026-01-01T19:05:00Z").toISOString(),
    })),
    deleteMessage: vi.fn(async () => {}),
    setMessageReaction: vi.fn(async (messageId, emoji, added) => ({
      messageId,
      channelId: TEXT_CHANNEL.id,
      emoji,
      count: added ? 1 : 0,
      userId: SELF.id,
      added,
    })),
    listPinnedMessages: vi.fn(async () => []),
    setMessagePinned: vi.fn(async (messageId: string, pinned: boolean) => ({
      id: messageId,
      channelId: "c1",
      author: { id: "u1", displayName: "Maja" },
      content: "",
      attachments: [],
      embeds: [],
      createdAt: new Date("2026-01-01T19:00:00Z").toISOString(),
      ...(pinned
        ? { pinnedAt: new Date("2026-01-01T19:10:00Z").toISOString() }
        : {}),
    })),
    uploadAttachment: vi.fn(async (file: File) => ({
      id: "att-1",
      url: "blob:fake",
      name: file.name,
      contentType: file.type,
      size: file.size,
    })),
    getAccount: vi.fn(async () => ACCOUNT),
    updateAccount: vi.fn(async (input) => ({ ...ACCOUNT, ...input })),
    updatePreferences: vi.fn(async (input) => ({
      ...ACCOUNT.preferences,
      ...input,
    })),
    changePassword: vi.fn(async () => "changed" as const),
    uploadAccountImage: vi.fn(async (kind) =>
      kind === "avatar"
        ? { ...ACCOUNT, avatarUrl: "/assets/avatar" }
        : { ...ACCOUNT, bannerUrl: "/assets/banner" },
    ),
    removeAccountImage: vi.fn(async () => ACCOUNT),
    getJoinSoundLibrary: vi.fn(async () => ({
      maxSeconds: 5,
      selectedId: null,
      servers: [],
    })),
    getSoundboard: vi.fn(async () => ({
      sounds: [],
      settings: { everyoneCanPlay: true, rateLimited: true },
      canManage: false,
    })),
    createSoundboardSound: vi.fn(async (input) => ({
      id: "sound-1",
      name: input.name,
      glyph: input.glyph,
      url: "/assets/att-1",
      durationSeconds: input.trimEndSeconds,
      trimStartSeconds: input.trimStartSeconds,
      trimEndSeconds: input.trimEndSeconds,
    })),
    updateSoundboardSound: vi.fn(async (soundId, patch) => ({
      id: soundId,
      name: patch.name ?? "Dźwięk",
      glyph: patch.glyph ?? "🔊",
      url: "/assets/att-1",
      durationSeconds: patch.trimEndSeconds ?? 1,
      trimStartSeconds: patch.trimStartSeconds ?? 0,
      trimEndSeconds: patch.trimEndSeconds ?? 1,
    })),
    deleteSoundboardSound: vi.fn(async () => {}),
    updateSoundboardSettings: vi.fn(async (patch) => ({
      everyoneCanPlay: patch.everyoneCanPlay ?? true,
      rateLimited: patch.rateLimited ?? true,
    })),
    ...overrides,
  };
}

/** In-memory SignalR stand-in kept strictly inside the test source tree. */
export class FakeRealtimeClient implements RealtimeClient {
  private status: RealtimeStatus = "idle";
  private mediaSessions = 0;
  private readonly events = new Emitter<RealtimeEventMap>();
  private readonly statusNotifier = new ChangeNotifier();

  constructor(private readonly selfUserId = SELF.id) {}

  getStatus(): RealtimeStatus {
    return this.status;
  }

  subscribeStatus = (listener: () => void): (() => void) =>
    this.statusNotifier.subscribe(listener);

  on<E extends RealtimeEventName>(
    event: E,
    handler: (payload: RealtimeEventMap[E]) => void,
  ): () => void {
    return this.events.on(event, handler);
  }

  push<E extends RealtimeEventName>(event: E, payload: RealtimeEventMap[E]): void {
    this.events.emit(event, payload);
  }

  async start(): Promise<void> {
    this.setStatus("connected");
  }

  async stop(): Promise<void> {
    this.setStatus("idle");
  }

  async setPresence(presence: Presence): Promise<void> {
    this.push("PresenceChanged", { userId: this.selfUserId, presence });
  }

  async joinChannel(_channelId: string): Promise<void> {}
  async sendTyping(_channelId: string): Promise<void> {}
  async joinVoice(_channelId: string): Promise<void> {}
  async leaveVoice(): Promise<void> {}
  async declineDirectCall(_conversationId: string): Promise<void> {}
  async sendVoiceSignal(_signal: VoiceSignal): Promise<void> {}

  /** A fresh id per call, as the hub hands out after closing the previous one. */
  async openMediaSession(_channelId: string): Promise<string> {
    this.mediaSessions += 1;
    return `media-session-${this.mediaSessions}`;
  }

  async sendMediaSignal(_signal: MediaSignal<BrowserMediaSignalKind>): Promise<void> {}
  async playSoundboard(_channelId: string, _soundId: string): Promise<void> {}

  async getRtcClock(): Promise<number> {
    return Date.now();
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusNotifier.notify();
  }
}

/**
 * A VoiceClient whose snapshot the test drives directly, so the dock can be
 * put into any connection state without a media stack.
 */
export class FakeVoiceClient implements VoiceClient {
  private state: VoiceState = IDLE_VOICE_STATE;
  private readonly listeners = new Set<() => void>();

  join = vi.fn(async (channelId: string) => {
    this.set({ channelId, connection: "connecting", peers: [] });
  });

  leave = vi.fn(async () => {
    this.state = IDLE_VOICE_STATE;
    this.emit();
  });

  reconnect = vi.fn(async () => {});

  setMuted = vi.fn((muted: boolean) => {
    this.set({
      muted,
      peers: this.state.peers.map((peer) =>
        peer.self ? { ...peer, muted, speaking: muted ? false : peer.speaking } : peer,
      ),
    });
  });

  setDeafened = vi.fn();

  setPeerVolume = vi.fn((userId: string, playbackVolume: number) => {
    this.set({
      peers: this.state.peers.map((peer) =>
        peer.userId === userId ? { ...peer, playbackVolume } : peer,
      ),
    });
  });

  setPeerGate = vi.fn((userId: string, gated: boolean) => {
    this.set({
      peers: this.state.peers.map((peer) =>
        peer.userId === userId ? { ...peer, gated } : peer,
      ),
    });
  });

  setPeerSuppression = vi.fn((userId: string, suppressed: boolean) => {
    this.set({
      peers: this.state.peers.map((peer) =>
        peer.userId === userId ? { ...peer, suppressed } : peer,
      ),
    });
  });

  applySettings = vi.fn(async (settings: VoiceSettings) => {
    this.set({
      noiseSuppressionActive:
        settings.noiseSuppression !== "browser" && settings.noiseSuppression !== "off",
    });
  });

  startScreenShare = vi.fn(async () => {
    this.set({
      localScreen: { streamId: "fake-screen", hasAudio: false, stream: null },
    });
  });

  stopScreenShare = vi.fn(async () => {
    this.set({ localScreen: null });
  });

  startCamera = vi.fn(async () => {
    this.set({
      localCamera: { streamId: "fake-camera", stream: null },
      cameraPending: false,
    });
  });

  stopCamera = vi.fn(async () => {
    this.set({ localCamera: null, cameraPending: false });
  });

  dispose = vi.fn();

  getSnapshot = (): VoiceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Test-only: push an arbitrary state. */
  set(patch: Partial<VoiceState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
