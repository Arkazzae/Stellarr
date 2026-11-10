import type { ChannelId, RtcConfig, UserId } from "@/lib/api/types";
import type { RealtimeClient, VoiceSignal } from "@/lib/realtime/types";
import {
  encodeRtcDescription,
  encodeRtcState,
  RTC_PROTOCOL_VERSION,
} from "@/lib/rtc/protocol";
import { profileFor } from "./audioProfiles";
import { AdaptiveBitrateController } from "./bitrate";
import { LifecycleWatcher } from "./lifecycle";
import { snapshotVoiceDevices, watchVoiceDevices, type VoiceDeviceSnapshot } from "./deviceMonitor";
import type { VoiceIceProvider } from "./iceSession";
import { captureMicrophone, MicCaptureError, type MicCapture } from "./micPipeline";
import { ParticipantPreferencesStore } from "./participantPreferences";
import { clampParticipantVolume } from "./remoteMixer";
import { DEFAULT_SETTINGS, needsRecapture, type VoiceSettings } from "./settings";
import { VoiceStateStore } from "./store";
import type { VoiceClient, VoiceError, VoicePeer, VoiceState } from "./types";
import { SpeechDetector } from "./vad";
import {
  channelKickedError,
  iceConfigError,
  joinFailedError,
  micError,
  moveFailedError,
  rejoinFailedError,
  rtcIncompatibility,
  sessionReplacedError,
  signalingFailedError,
} from "./webrtcErrors";
import { CallHealth } from "./webrtcHealth";
import { LocalMicrophone } from "./webrtcMicrophone";
import { Mesh } from "./webrtcMesh";
import { Negotiator, type Peer } from "./webrtcPeer";
import { RemoteAudio } from "./webrtcRemoteAudio";
import { planDeviceChange, SettingsQueue, type SettingsChange } from "./webrtcSettings";

export { degradedNotice, rtcIncompatibility } from "./webrtcErrors";

export interface WebRtcVoiceClientOptions {
  realtime: RealtimeClient;
  selfUserId: UserId;
  selfDisplayName: string;
  /**
   * Called once per voice session and read once per peer connection, so a
   * channel with three people costs one `/api/bootstrap` call rather than three.
   */
  ice: VoiceIceProvider;
  /** Current settings; read fresh on every capture. */
  getSettings?: () => VoiceSettings;
  /** Persists an automatic fallback after an input/output device disappears. */
  updateSettings?: (patch: Partial<VoiceSettings>) => void;
  /**
   * How each other person sounds to this account: volume, gate, noise
   * removal. Without one, the choices live only as long as this client.
   */
  participantPreferences?: ParticipantPreferencesStore;
  /** Stats cadence. Observational only: media never depends on it. */
  statsIntervalMs?: number;
  /** Grace before a `disconnected` peer is nudged with an ICE restart. */
  recoveryGraceMs?: number;
  /** Bootstrap contract used to refuse an incompatible media implementation. */
  rtc: Pick<RtcConfig, "protocolVersion" | "topology">;
}

/**
 * Peer-to-peer voice over WebRTC, signalled through the SignalR hub.
 *
 * Every person in the channel gets a direct connection to every other: a full
 * mesh, which suits a handful of friends on one instance. This class is the
 * facade the UI sees through `VoiceClient`; the work lives in its siblings:
 * `webrtcPeer` (connections and negotiation), `webrtcRemoteAudio` (what the
 * others sound like), `webrtcMicrophone` (what they hear), `webrtcSettings`
 * (live changes) and `webrtcHealth` (proof that audio flows, and recovery).
 */
export class WebRtcVoiceClient implements VoiceClient {
  private readonly store = new VoiceStateStore();
  private readonly peers = new Map<UserId, Peer>();
  private readonly unsubscribes: Array<() => void> = [];
  private readonly speech: SpeechDetector;
  private readonly lifecycle: LifecycleWatcher;
  private readonly bitrate: AdaptiveBitrateController;
  private readonly preferences: ParticipantPreferencesStore;
  private readonly negotiator: Negotiator;
  private readonly remoteAudio: RemoteAudio;
  private readonly microphone: LocalMicrophone;
  private readonly health: CallHealth;
  private readonly mesh: Mesh;
  private readonly settingsQueue: SettingsQueue;

  private channelId: ChannelId | null = null;
  private settings: VoiceSettings;
  private selfLevel = 0;
  private selfSpeaking = false;
  private disposed = false;
  private deviceSnapshot: VoiceDeviceSnapshot | null = null;

  /**
   * Bumped on every join and leave. Every async continuation checks it before
   * touching state, so a slow `getUserMedia` from a call the person already
   * left can never resurrect it.
   */
  private session = 0;

  constructor(private readonly options: WebRtcVoiceClientOptions) {
    this.settings = options.getSettings?.() ?? { ...DEFAULT_SETTINGS };
    const profile = profileFor(this.settings);
    this.bitrate = new AdaptiveBitrateController({
      ceiling: profile.maxBitrate,
      floor: profile.minBitrate,
    });
    // In-memory unless the composition root hands over a persisted store.
    this.preferences = options.participantPreferences ?? new ParticipantPreferencesStore(null);

    this.speech = new SpeechDetector(
      (id, reading) => {
        if (id === options.selfUserId) {
          this.selfLevel = reading.level;
          this.selfSpeaking = reading.speaking && !this.store.getSnapshot().muted;
        } else {
          const peer = this.peers.get(id);
          if (!peer) return;
          peer.level = reading.level;
          peer.speaking = reading.speaking;
        }
        this.publishPeers();
      },
      { sensitivity: this.settings.vadSensitivity },
    );
    this.lifecycle = new LifecycleWatcher({
      onResume: () => {
        void this.recoverAfterResume();
      },
    });

    this.negotiator = new Negotiator({
      settings: () => this.settings,
      bitrate: () => this.bitrate.getBitrate(),
      send: (peer, type, sdp) =>
        this.send({ kind: type, toUserId: peer.userId, payload: encodeRtcDescription(type, sdp) }),
    });
    this.remoteAudio = new RemoteAudio({
      peers: this.peers,
      speech: this.speech,
      settings: () => this.settings,
      forgetOutputDevice: () => options.updateSettings?.({ outputDeviceId: null }),
      changed: () => this.publishPeers(),
    });
    this.microphone = new LocalMicrophone({
      selfUserId: options.selfUserId,
      store: this.store,
      speech: this.speech,
      peers: this.peers,
      applyEncoding: () => this.mesh.applyMicEncoding(),
      rebuildPeer: (peer) => this.mesh.rebuild(peer),
      onDeviceLost: () => {
        void this.recaptureAfterDeviceLoss();
      },
    });
    this.health = new CallHealth({
      realtime: options.realtime,
      ice: options.ice,
      store: this.store,
      peers: this.peers,
      bitrate: this.bitrate,
      statsIntervalMs: options.statsIntervalMs,
      recoveryGraceMs: options.recoveryGraceMs,
      activeSession: () => (this.disposed || this.channelId === null ? null : this.session),
      reoffer: (peer) => this.negotiator.offer(peer),
      applyMicEncoding: () => this.mesh.applyMicEncoding(),
    });
    this.mesh = new Mesh(this.peers, {
      selfUserId: options.selfUserId,
      ice: options.ice,
      preferences: this.preferences,
      negotiator: this.negotiator,
      remoteAudio: this.remoteAudio,
      microphone: this.microphone,
      health: this.health,
      bitrate: () => this.bitrate.getBitrate(),
      send: (signal) => this.send(signal),
      announceTo: (peer) => {
        void this.send({ kind: "state", toUserId: peer.userId, payload: this.statePayload() });
      },
      session: () => this.session,
      isStale: (session) => this.isStale(session),
      changed: () => this.publishPeers(),
    });
    this.settingsQueue = new SettingsQueue(
      (change) => this.applySettingsNow(change),
      () => this.disposed,
    );
  }

  getSnapshot = (): VoiceState => this.store.getSnapshot();

  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);

  // ---------------------------------------------------------------- session

  async join(channelId: ChannelId): Promise<void> {
    if (this.disposed) return;
    const incompatibility = rtcIncompatibility(this.options.rtc);
    if (incompatibility) {
      this.store.set({
        channelId,
        connection: "failed",
        transport: {
          signaling: "disconnected",
          media: "failed",
          peerCount: 0,
          connectedPeerCount: 0,
        },
        error: { kind: "unsupported", message: incompatibility },
      });
      return;
    }
    if (this.channelId === channelId && this.store.getSnapshot().connection !== "failed") return;

    // This method starts in the channel button's user gesture. Create the audio
    // contexts now: doing it later in `ontrack` makes Brave/Chromium leave them
    // suspended even though RTP continues to arrive normally.
    this.preparePlayback();
    if (this.channelId) await this.leave();

    const session = ++this.session;
    this.channelId = channelId;
    this.settings = this.options.getSettings?.() ?? this.settings;
    this.store.set({
      channelId,
      connection: "requesting-mic",
      transport: { signaling: "idle", media: "idle", peerCount: 0, connectedPeerCount: 0 },
      error: null,
      degraded: null,
      peers: [this.selfPeer(false)],
    });

    const opened = await this.openMicrophone(session);
    if (!opened) return;
    if (this.isStale(session)) {
      opened.capture.dispose();
      return;
    }
    this.microphone.adopt(opened.capture, opened.settings);
    if (this.microphone.needsReopen(this.settings)) {
      // The settings changed while the device was opening.
      await this.reopenMicrophone();
      if (this.isStale(session)) return;
    }
    this.store.set({
      connection: "connecting",
      transport: {
        signaling: "connecting",
        media: "ready",
        peerCount: 0,
        connectedPeerCount: 0,
      },
    });

    // Refresh the ICE configuration *before* anything can use it. The server's
    // TURN credentials last an hour and this tab may have been open for a day.
    let iceServers: RTCIceServer[];
    try {
      iceServers = await this.options.ice.beginSession();
    } catch (cause) {
      if (session === this.session) this.abortJoin(iceConfigError(cause));
      return;
    }
    if (this.isStale(session)) return;
    this.health.scheduleIceRefresh(session, iceServers);

    this.listen();
    this.lifecycle.start();

    try {
      await this.options.realtime.joinVoice(channelId);
    } catch {
      if (session === this.session) this.abortJoin(joinFailedError);
      return;
    }
    if (this.isStale(session)) return;

    this.markConnected();
    this.health.startStats();
  }

  async leave(): Promise<void> {
    const wasJoined = this.channelId !== null;
    this.channelId = null;
    this.session += 1;

    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.mesh.dropAll();

    this.health.stop();
    this.lifecycle.stop();
    this.bitrate.reset();
    this.releaseMicrophone();
    this.remoteAudio.removeHost();
    this.options.ice.endSession();

    if (wasJoined) {
      try {
        await this.options.realtime.leaveVoice();
      } catch {
        // Leaving locally must always succeed, even if the hub is gone.
      }
    }
    this.store.reset();
  }

  dispose(): void {
    this.disposed = true;
    void this.leave();
    this.speech.dispose();
    this.remoteAudio.dispose();
    this.lifecycle.stop();
  }

  setMuted(muted: boolean): void {
    if (this.store.getSnapshot().muted === muted) return;
    this.microphone.setMuted(muted);
    if (muted) this.selfSpeaking = false;
    this.store.set({ muted });
    this.publishPeers();
    void this.broadcastState();
  }

  setDeafened(deafened: boolean): void {
    this.remoteAudio.setDeafened(deafened);
  }

  setPeerVolume(userId: UserId, volume: number): void {
    const peer = this.peers.get(userId);
    const next = clampParticipantVolume(volume);
    if (!peer || peer.playbackVolume === next) return;
    peer.playbackVolume = next;
    this.preferences.set(userId, { volume: next });
    this.remoteAudio.applyVolume(peer);
    this.publishPeers();
  }

  setPeerGate(userId: UserId, gated: boolean): void {
    const peer = this.peers.get(userId);
    const next = Boolean(gated);
    if (!peer || peer.gated === next) return;
    peer.gated = next;
    this.preferences.set(userId, { gated: next });
    this.remoteAudio.applyGate(peer);
    this.publishPeers();
  }

  setPeerSuppression(userId: UserId, suppressed: boolean): void {
    const peer = this.peers.get(userId);
    const next = Boolean(suppressed);
    if (!peer || peer.suppressed === next) return;
    peer.suppressed = next;
    this.preferences.set(userId, { suppressed: next });
    this.remoteAudio.applySuppression(peer);
    this.publishPeers();
  }

  // Camera and screen share arrive with the video half of this client.
  startScreenShare(): Promise<void> {
    return Promise.reject<void>({
      kind: "screen-share",
      message: "Nie udało się udostępnić ekranu.",
      recoverable: true,
    } satisfies VoiceError);
  }

  stopScreenShare(): Promise<void> {
    return Promise.resolve();
  }

  startCamera(): Promise<void> {
    return Promise.reject<void>({
      kind: "camera",
      message: "Nie udało się włączyć kamery. Sprawdź urządzenie i spróbuj ponownie.",
      recoverable: true,
    } satisfies VoiceError);
  }

  stopCamera(): Promise<void> {
    return Promise.resolve();
  }

  // --------------------------------------------------------------- settings

  /**
   * Apply changed settings without dropping the call.
   *
   * Only capture-affecting changes reopen the device; a profile or sensitivity
   * change is applied in place. If the new device cannot be opened the old
   * capture is still running, so the call continues and the error is reported
   * as recoverable rather than fatal.
   */
  applySettings(next: VoiceSettings): Promise<void> {
    return this.settingsQueue.push({
      settings: next,
      recaptureMic: false,
      refreshPlayback: false,
    });
  }

  private async applySettingsNow(change: SettingsChange): Promise<void> {
    const previous = this.settings;
    const next = change.settings;
    this.settings = next;

    this.speech.setSensitivity(next.vadSensitivity);
    this.microphone.tune(next);
    this.remoteAudio.setProfile(next.playbackProfile, next.playbackTuning);

    if (
      change.refreshPlayback ||
      previous.outputDeviceId !== next.outputDeviceId ||
      previous.outputVolume !== next.outputVolume
    ) {
      await this.remoteAudio.refreshOutput();
    }

    if (previous.opusProfile !== next.opusProfile) {
      const profile = profileFor(next);
      this.bitrate.setCeiling(profile.maxBitrate, profile.minBitrate);
      await this.mesh.applyMicEncoding();
      // The fmtp ceiling lives in the SDP, so the profile change needs a pass.
      await this.mesh.renegotiateAll();
    }

    if (this.channelId === null) return;
    const session = this.session;
    const swapped = await this.microphone.replace(
      next,
      change.recaptureMic,
      () => this.isStale(session) || this.supersedesCapture(next),
    );
    // A peer that missed an earlier state frame is caught up by this one.
    if (swapped) void this.broadcastState();
  }

  /** A newer request is waiting that would make a capture for `current` stale. */
  private supersedesCapture(current: VoiceSettings): boolean {
    const waiting = this.settingsQueue.pending;
    return waiting !== null && (waiting.recaptureMic || needsRecapture(current, waiting.settings));
  }

  private reopenMicrophone(): Promise<void> {
    return this.settingsQueue.push({
      settings: this.settings,
      recaptureMic: true,
      refreshPlayback: false,
    });
  }

  private async recaptureAfterDeviceLoss(): Promise<void> {
    if (this.channelId === null) return;
    if (this.settings.inputDeviceId !== null) {
      this.options.updateSettings?.({ inputDeviceId: null });
    }
    // The system-default id did not change when its physical endpoint did, so
    // equality-based settings logic must be told to reopen it.
    await this.settingsQueue.push({
      settings: { ...this.settings, inputDeviceId: null },
      recaptureMic: true,
      refreshPlayback: false,
    });
  }

  private async handleDevicesChanged(devices: readonly MediaDeviceInfo[]): Promise<void> {
    const previous = this.deviceSnapshot;
    const next = snapshotVoiceDevices(devices);
    this.deviceSnapshot = next;
    if (previous === null || this.disposed || this.channelId === null) return;

    const plan = planDeviceChange(this.settings, previous, next);
    if (!plan) return;
    if (Object.keys(plan.persist).length > 0) this.options.updateSettings?.(plan.persist);
    await this.settingsQueue.push(plan.change);
  }

  // ------------------------------------------------------------- microphone

  /**
   * Open the microphone for joining.
   *
   * A device id persisted from a headset that is gone must not stop the person
   * from joining: it is retried once on the system route, and the working
   * choice is remembered. A permission failure deliberately does not take that
   * path, since a second prompt cannot repair a denied origin. Null when the
   * join failed or was superseded meanwhile.
   */
  private async openMicrophone(
    session: number,
  ): Promise<{ capture: MicCapture; settings: VoiceSettings } | null> {
    let settings = this.settings;
    try {
      return { capture: await captureMicrophone(settings), settings };
    } catch (cause) {
      if (session !== this.session) return null;
      const retryable =
        settings.inputDeviceId !== null &&
        cause instanceof MicCaptureError &&
        cause.kind === "unavailable";
      if (!retryable) {
        this.abortJoin(micError(cause));
        return null;
      }
    }

    settings = { ...settings, inputDeviceId: null };
    this.settings = settings;
    this.options.updateSettings?.({ inputDeviceId: null });
    try {
      return { capture: await captureMicrophone(settings), settings };
    } catch (cause) {
      if (session === this.session) this.abortJoin(micError(cause));
      return null;
    }
  }

  private releaseMicrophone(): void {
    this.microphone.release();
    this.selfLevel = 0;
    this.selfSpeaking = false;
  }

  // -------------------------------------------------------------- signaling

  private listen(): void {
    const { realtime } = this.options;
    const unlockPlayback = () => this.preparePlayback();
    this.deviceSnapshot = null;
    document.addEventListener("pointerdown", unlockPlayback, true);
    document.addEventListener("keydown", unlockPlayback, true);
    this.unsubscribes.push(
      () => document.removeEventListener("pointerdown", unlockPlayback, true),
      () => document.removeEventListener("keydown", unlockPlayback, true),
      watchVoiceDevices((devices) => {
        void this.handleDevicesChanged(devices);
      }),
      realtime.on("VoiceParticipantChanged", (event) => {
        if (event.channelId === this.channelId) void this.mesh.reconcile(event.participants);
      }),
      realtime.on("VoiceSessionReplaced", (event) => {
        if (event.channelId === this.channelId) void this.endWithError(sessionReplacedError);
      }),
      realtime.on("VoiceChannelKicked", (event) => {
        if (event.channelId === this.channelId) void this.endWithError(channelKickedError);
      }),
      realtime.on("VoiceChannelMoved", (event) => {
        if (event.fromChannelId === this.channelId) void this.followMove(event.toChannelId);
      }),
      realtime.on("DirectCallDeclined", (event) => {
        if (event.channelId === this.channelId) void this.leave();
      }),
      realtime.on("VoiceSignal", (signal) => {
        if (signal.channelId === this.channelId) void this.mesh.handleSignal(signal);
      }),
      realtime.subscribeStatus(() => this.onRealtimeStatus()),
    );
  }

  /** Leave, then show why: the server ended this seat, not the person. */
  private async endWithError(error: VoiceError): Promise<void> {
    if (this.channelId === null) return;
    await this.leave();
    if (!this.disposed) this.store.set({ connection: "failed", error });
  }

  /**
   * Follow an administrator move without reopening the microphone.
   *
   * The HTTP endpoint has already moved this SignalR connection's authoritative
   * seat. Re-invoking JoinVoice confirms that state and asks the hub for the
   * target snapshot; only peer connections are rebuilt, because they belong to
   * the old room.
   */
  private async followMove(targetChannelId: ChannelId): Promise<void> {
    if (this.channelId === null || this.channelId === targetChannelId) return;

    this.mesh.dropAll();
    this.channelId = targetChannelId;
    this.store.set({
      channelId: targetChannelId,
      connection: "connecting",
      transport: {
        signaling: "connecting",
        media: this.microphone.capture === null ? "idle" : "ready",
        peerCount: 0,
        connectedPeerCount: 0,
      },
      error: null,
      peers: [this.selfPeer(this.selfSpeaking)],
    });

    try {
      await this.options.realtime.joinVoice(targetChannelId);
    } catch {
      if (this.channelId === targetChannelId) await this.endWithError(moveFailedError);
      return;
    }
    if (this.disposed || this.channelId !== targetChannelId) return;
    this.markConnected();
  }

  /**
   * Follow the hub without tearing down healthy media.
   *
   * A SignalR reconnect says nothing about the peer connections: they are
   * direct, and they usually keep working perfectly while the hub is away. So
   * the state shows "reconnecting" for honesty, and on recovery we rejoin the
   * voice group and re-announce, rather than rebuilding anything that is fine.
   */
  private onRealtimeStatus(): void {
    if (!this.channelId) return;
    const status = this.options.realtime.getStatus();
    const connection = this.store.getSnapshot().connection;

    if (status === "reconnecting" || status === "connecting") {
      this.setSignaling(status);
      if (connection === "connected") this.store.set({ connection: "reconnecting" });
    } else if (status === "disconnected" || status === "idle") {
      this.setSignaling("disconnected");
    } else if (status === "connected" && connection === "reconnecting") {
      void this.rejoinAfterReconnect();
    }
  }

  private async rejoinAfterReconnect(): Promise<void> {
    const channelId = this.channelId;
    if (!channelId) return;
    const session = this.session;

    try {
      await this.options.realtime.joinVoice(channelId);
    } catch {
      if (session === this.session) this.store.set({ error: rejoinFailedError });
      return;
    }
    if (this.isStale(session)) return;

    this.setSignaling("connected");
    this.store.set({ connection: "connected", error: null });
    // Whoever joined while we were away has no idea what our state is.
    void this.broadcastState();
    await this.health.repairUnhealthy();
  }

  private async send(signal: Omit<VoiceSignal, "channelId" | "protocolVersion">): Promise<void> {
    const channelId = this.channelId;
    if (!channelId) return;
    const session = this.session;
    if (signal.toUserId !== undefined && !this.peers.has(signal.toUserId)) return;
    try {
      await this.options.realtime.sendVoiceSignal({
        ...signal,
        protocolVersion: RTC_PROTOCOL_VERSION,
        channelId,
      });
    } catch {
      // A frame addressed to one peer can finish after that peer left or after
      // this client moved rooms; peer recovery owns targeted failures. A
      // dropped broadcast during a hub reconnect is expected too, since the
      // rejoin re-announces. Only report when the hub is supposed to be up.
      if (
        !this.isStale(session) &&
        channelId === this.channelId &&
        signal.toUserId === undefined &&
        this.options.realtime.getStatus() === "connected"
      ) {
        this.store.set({ error: signalingFailedError });
      }
    }
  }

  private async broadcastState(): Promise<void> {
    if (!this.channelId) return;
    await this.send({ kind: "state", payload: this.statePayload() });
  }

  private statePayload(): string {
    return encodeRtcState({
      muted: this.store.getSnapshot().muted,
      screenStreamId: null,
      cameraStreamId: null,
    });
  }

  /**
   * Runs when the tab comes back, the page is restored, or the network returns.
   *
   * Only unhealthy peers are touched. Rebuilding a connection that is working
   * would introduce the very glitch this is meant to avoid.
   */
  private async recoverAfterResume(): Promise<void> {
    if (this.disposed || !this.channelId) return;

    if (!(await this.microphone.resume())) {
      // captureMicrophone falls back to browser suppression if a new
      // processing context cannot run either.
      await this.reopenMicrophone();
    }
    await this.speech.resume();
    await this.remoteAudio.resume();
    await this.health.repairUnhealthy();
  }

  /** Synchronous by design: callers invoke it from an active user gesture. */
  private preparePlayback(): void {
    this.speech.prepare();
    this.remoteAudio.prepare();
  }

  // ------------------------------------------------------------ bookkeeping

  private isStale(session: number): boolean {
    return this.disposed || session !== this.session;
  }

  private abortJoin(error: VoiceError): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.releaseMicrophone();
    this.health.stop();
    this.lifecycle.stop();
    this.options.ice.endSession();
    this.store.set({ connection: "failed", error });
  }

  private markConnected(): void {
    this.setSignaling("connected");
    this.store.set({ connection: "connected" });
    this.health.syncTransport();
    this.publishPeers();
    void this.broadcastState();
  }

  private setSignaling(signaling: VoiceState["transport"]["signaling"]): void {
    const transport = this.store.getSnapshot().transport;
    this.store.set({ transport: { ...transport, signaling } });
  }

  private selfPeer(speaking: boolean): VoicePeer {
    return {
      userId: this.options.selfUserId,
      displayName: this.options.selfDisplayName,
      muted: this.store.getSnapshot().muted,
      speaking,
      level: this.selfLevel,
      playbackVolume: 100,
      gated: false,
      suppressed: false,
      self: true,
      screen: null,
      camera: null,
    };
  }

  private publishPeers(): void {
    this.store.set({
      peers: [
        this.selfPeer(this.selfSpeaking),
        ...[...this.peers.values()].map((peer) => ({
          userId: peer.userId,
          displayName: peer.displayName,
          muted: peer.muted,
          speaking: peer.speaking && !peer.muted,
          level: peer.level,
          playbackVolume: peer.playbackVolume,
          gated: peer.gated,
          suppressed: peer.suppressed,
          self: false,
          screen: null,
          camera: null,
        })),
      ],
    });
  }

  // `CallHealth` runs these jobs on its own timers. They stay reachable here so
  // a call can be driven step by step from outside, without waiting for them.
  private sampleStats(): Promise<void> {
    return this.health.sample();
  }

  private refreshIceConfiguration(session: number): Promise<void> {
    return this.health.refreshIce(session);
  }
}
