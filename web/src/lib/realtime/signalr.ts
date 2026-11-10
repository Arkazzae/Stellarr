import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
  type IRetryPolicy,
} from "@microsoft/signalr";
import { ACTIVE_SERVER_STORAGE_KEY } from "@/lib/api/client";
import type { ChannelId, Presence, RtcConfig } from "@/lib/api/types";
import { RTC_HUB } from "@/lib/rtc/protocol";
import { ChangeNotifier, Emitter } from "./emitter";
import { HUB_DECODERS } from "./hubPayloads";
import type {
  RealtimeClient,
  RealtimeEventMap,
  RealtimeEventName,
  RealtimeStatus,
  VoiceSignal,
} from "./types";

export { parseSoundboardPlayed, parseVoiceSignal } from "./hubPayloads";

const RETRY_DELAYS_MS = [0, 2_000, 5_000, 10_000, 20_000, 30_000] as const;
/** The restart timer never fires sooner than this, whatever the backoff says. */
const MIN_RESTART_DELAY_MS = 1_000;

/** Backoff for the n-th retry (0-based); the last delay repeats forever. */
export const signalRRetryDelay = (attempt: number): number =>
  RETRY_DELAYS_MS[
    Math.min(Math.max(0, Math.floor(attempt)), RETRY_DELAYS_MS.length - 1)
  ] ?? 30_000;

/**
 * Hub auth is cookie-based, so the hub must stay on the current origin. Only a
 * rooted path is accepted; anything that a browser could read as an absolute or
 * protocol-relative URL falls back to the default hub.
 */
export const signalingHubPath = (candidate: unknown): string =>
  typeof candidate === "string" &&
  candidate.startsWith("/") &&
  !candidate.startsWith("//") &&
  !candidate.includes("\\")
    ? candidate
    : RTC_HUB.url;

// SignalR's array policy gives up after its last delay. Voice has to survive a
// laptop sleep or a long outage, so the final delay repeats until `stop()`.
const RETRY_POLICY: IRetryPolicy = {
  nextRetryDelayInMilliseconds: ({ previousRetryCount }) =>
    signalRRetryDelay(previousRetryCount),
};

export type SignalRConnectionFactory = (hubUrl: string) => HubConnection;

const buildConnection: SignalRConnectionFactory = (hubUrl) =>
  new HubConnectionBuilder()
    .withUrl(hubUrl, { withCredentials: true })
    .withAutomaticReconnect(RETRY_POLICY)
    .configureLogging(LogLevel.Warning)
    .build();

const HUB_EVENTS = Object.keys(HUB_DECODERS) as RealtimeEventName[];

function activeServerId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * SignalR-backed realtime client. The hub is on the same origin, so the
 * HttpOnly session cookie authenticates the socket and no token is passed.
 */
export class SignalRRealtimeClient implements RealtimeClient {
  private connection: HubConnection | null = null;
  private hubUrl: string = RTC_HUB.url;
  private status: RealtimeStatus = "idle";
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  /** True between `start()` and `stop()`; it is what restarts act on. */
  private desired = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  /**
   * Bumped by every `start` and `stop`. A negotiation that finishes after its
   * generation was superseded closes itself instead of becoming a second live
   * connection, as happens after a StrictMode remount or a sign-out in flight.
   */
  private generation = 0;
  /** Last accepted occupancy frame per room, to reject reordered hub sends. */
  private readonly voiceSequences = new Map<ChannelId, number>();
  private readonly events = new Emitter<RealtimeEventMap>();
  private readonly statusNotifier = new ChangeNotifier();

  constructor(
    private readonly connectionFactory: SignalRConnectionFactory = buildConnection,
  ) {}

  configureRtc(rtc: Pick<RtcConfig, "signalingHub"> | undefined): void {
    if (this.connection !== null || this.starting !== null) return;
    this.hubUrl = signalingHubPath(rtc?.signalingHub);
  }

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

  async start(): Promise<void> {
    this.desired = true;
    if (this.stopping !== null) {
      await this.stopping;
      if (!this.desired) return;
    }
    if (this.starting !== null) return this.starting;
    if (
      this.connection !== null &&
      this.connection.state !== HubConnectionState.Disconnected
    ) {
      return;
    }
    this.clearRestartTimer();

    const connection = this.connectionFactory(this.hubUrlForActiveServer());
    for (const event of HUB_EVENTS) {
      if (event === "VoiceParticipantChanged") {
        this.relay(connection, event, (snapshot) => this.isFreshSnapshot(snapshot));
      } else {
        this.relay(connection, event);
      }
    }
    this.watchLifecycle(connection);

    const generation = (this.generation += 1);
    this.connection = connection;
    this.voiceSequences.clear();
    this.setStatus("connecting");

    const starting: Promise<void> = this.negotiate(connection, generation).finally(
      () => {
        if (this.starting === starting) this.starting = null;
      },
    );
    this.starting = starting;
    return starting;
  }

  async stop(): Promise<void> {
    this.desired = false;
    this.clearRestartTimer();
    this.restartAttempts = 0;
    if (this.stopping !== null) return this.stopping;

    // Invalidate any negotiation in flight before touching the connection.
    const generation = (this.generation += 1);
    const connection = this.connection;
    this.connection = null;
    this.starting = null;

    // Subscribers own their handlers and release them through the function `on`
    // returns, so stopping must not clear them: that would silently detach a
    // provider that is still mounted whenever the socket is cycled.
    const stopping = (async () => {
      try {
        await connection?.stop();
      } finally {
        // A newer start may have taken over while this was suspended; an
        // obsolete stop must not overwrite that connection's status.
        if (generation === this.generation && !this.desired) {
          this.setStatus("idle");
        }
      }
    })();
    this.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.stopping === stopping) this.stopping = null;
    }
  }

  setPresence(presence: Presence): Promise<void> {
    return this.invoke("SetPresence", presence);
  }

  joinChannel(channelId: ChannelId): Promise<void> {
    return this.invoke("JoinChannel", channelId);
  }

  sendTyping(channelId: ChannelId): Promise<void> {
    return this.invoke("SendTyping", channelId);
  }

  joinVoice(channelId: ChannelId): Promise<void> {
    return this.invoke(RTC_HUB.methods.join, channelId);
  }

  leaveVoice(): Promise<void> {
    return this.invoke(RTC_HUB.methods.leave);
  }

  declineDirectCall(conversationId: ChannelId): Promise<void> {
    return this.invoke(RTC_HUB.methods.declineDirectCall, conversationId);
  }

  sendVoiceSignal(signal: VoiceSignal): Promise<void> {
    return this.invoke(RTC_HUB.methods.signal, signal);
  }

  playSoundboard(channelId: ChannelId, soundId: string): Promise<void> {
    return this.invoke(RTC_HUB.methods.playSoundboard, channelId, soundId);
  }

  getRtcClock(): Promise<number> {
    return this.invoke<number>(RTC_HUB.methods.clock);
  }

  private async invoke<T = void>(method: string, ...args: unknown[]): Promise<T> {
    const connection = this.connection;
    if (connection === null || connection.state !== HubConnectionState.Connected) {
      throw new Error(`Cannot call ${method}: realtime connection is not open`);
    }
    return connection.invoke<T>(method, ...args);
  }

  private hubUrlForActiveServer(): string {
    const serverId = activeServerId();
    if (serverId === null) return this.hubUrl;
    const separator = this.hubUrl.includes("?") ? "&" : "?";
    return `${this.hubUrl}${separator}serverId=${encodeURIComponent(serverId)}`;
  }

  /**
   * Forwards one hub event to subscribers once its payload has been validated
   * and, where given, admitted.
   */
  private relay<E extends RealtimeEventName>(
    connection: HubConnection,
    event: E,
    admit: (payload: RealtimeEventMap[E]) => boolean = () => true,
  ): void {
    const decode = HUB_DECODERS[event];
    connection.on(event, (payload: unknown) => {
      const decoded = decode(payload);
      if (decoded !== null && admit(decoded)) this.events.emit(event, decoded);
    });
  }

  private isFreshSnapshot({
    channelId,
    sequence,
  }: RealtimeEventMap["VoiceParticipantChanged"]): boolean {
    if (sequence === undefined) return true;
    const previous = this.voiceSequences.get(channelId);
    if (previous !== undefined && sequence <= previous) return false;
    this.voiceSequences.set(channelId, sequence);
    return true;
  }

  private watchLifecycle(connection: HubConnection): void {
    connection.onreconnecting(() => {
      if (this.connection === connection) this.setStatus("reconnecting");
    });
    connection.onreconnected(() => {
      if (this.connection !== connection) return;
      this.restartAttempts = 0;
      // A server restart resets its process-local sequence. The voice client
      // rejoins right after this transition and gets a fresh authoritative frame.
      this.voiceSequences.clear();
      this.setStatus("connected");
    });
    connection.onclose(() => {
      if (this.connection !== connection) return;
      this.connection = null;
      this.setStatus("disconnected");
      this.scheduleRestart();
    });
  }

  private async negotiate(
    connection: HubConnection,
    generation: number,
  ): Promise<void> {
    try {
      await connection.start();
    } catch (cause) {
      if (generation === this.generation) {
        if (this.connection === connection) this.connection = null;
        this.setStatus("disconnected");
        this.scheduleRestart();
      }
      throw cause;
    }
    if (generation !== this.generation) {
      await connection.stop().catch(() => undefined);
      return;
    }
    this.restartAttempts = 0;
    this.setStatus("connected");
  }

  /**
   * SignalR's own reconnect only begins once a connection has started, so a
   * failed first negotiation and a terminal close are retried from here.
   */
  private scheduleRestart(): void {
    if (!this.desired || this.restartTimer !== null) return;
    const delay = signalRRetryDelay(this.restartAttempts);
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.desired) void this.start().catch(() => undefined);
    }, Math.max(MIN_RESTART_DELAY_MS, delay));
  }

  private clearRestartTimer(): void {
    if (this.restartTimer === null) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusNotifier.notify();
  }
}
