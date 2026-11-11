import type { Translator } from "@/i18n";
import { translateForDocument } from "@/i18n/defaultLocale";
import type { ChannelId, RtcConfig, UserId } from "@/lib/api/types";
import type { RealtimeClient, VoiceSignal } from "@/lib/realtime/types";
import { decodeRtcState, encodeRtcState, RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import { profileFor } from "./audioProfiles";
import { AdaptiveBitrateController } from "./bitrate";
import { cameraIsSupported } from "./camera";
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
import { LocalCamera, LocalScreen, type LocalVideoEnv } from "./webrtcLocalVideo";
import { LocalMicrophone } from "./webrtcMicrophone";
import { Mesh } from "./webrtcMesh";
import {
  receiveRemoteState,
  receiveRemoteTrack,
  type Participant,
  type ParticipantMediaEnv,
} from "./webrtcParticipant";
import { RemoteAudio } from "./webrtcRemoteAudio";
import { planDeviceChange, SettingsQueue, type SettingsChange } from "./webrtcSettings";
import { Sfu } from "./webrtcSfu";
import type { CallTopology } from "./webrtcTopology";

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
  /**
   * Words the failures the person is told about. Called when a failure
   * happens, so it should answer in the language they have at that moment.
   * Without one the client follows the page's language.
   */
  translate?: Translator;
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
  /**
   * Grace before a `disconnected` peer is nudged with an ICE restart, or,
   * behind a media server, before its connection is replaced.
   */
  recoveryGraceMs?: number;
  /**
   * Behind a media server: the pause before a lost connection is replaced.
   * Each further replacement in a row waits twice as long.
   */
  mediaReplacementPauseMs?: number;
  /** Bootstrap contract used to refuse an incompatible media implementation. */
  rtc: Pick<RtcConfig, "protocolVersion" | "topology"> & {
    capabilities?: Pick<RtcConfig["capabilities"], "camera">;
  };
}

/**
 * Voice over WebRTC, signalled through the SignalR hub.
 *
 * This class is the facade the UI sees through `VoiceClient`. It keeps apart
 * the two things a call is made of. The people (`webrtcParticipant`,
 * `webrtcRemoteAudio`, `webrtcRemoteMedia`) are what the others sound like and
 * which of their streams is which. The connections belong to a `CallTopology`
 * (`webrtcTopology`), the one the bootstrap names: a full mesh (`webrtcMesh`,
 * `webrtcMeshHealth`), where every person in the channel gets a direct
 * connection to every other, which suits a handful of friends on one instance;
 * or one connection to Stellarr Media (`webrtcSfu`, `webrtcSfuDirectory`,
 * `webrtcSfuHealth`), which forwards everybody's tracks. Around both sit
 * `webrtcPeer` (a connection and its negotiation), `webrtcMicrophone` and
 * `webrtcLocalVideo` (what the others hear and see), `webrtcSettings` (live
 * changes) and `webrtcHealth` (the stats and credential clocks, and the proof
 * that audio flows).
 */
export class WebRtcVoiceClient implements VoiceClient {
  private readonly store = new VoiceStateStore();
  /** Everyone else in the call. Only the topology adds or removes a person. */
  private readonly people = new Map<UserId, Participant>();
  private readonly unsubscribes: Array<() => void> = [];
  private readonly speech: SpeechDetector;
  private readonly lifecycle: LifecycleWatcher;
  private readonly bitrate: AdaptiveBitrateController;
  private readonly preferences: ParticipantPreferencesStore;
  private readonly remoteAudio: RemoteAudio;
  private readonly personMedia: ParticipantMediaEnv;
  private readonly microphone: LocalMicrophone;
  private readonly camera: LocalCamera;
  private readonly screen: LocalScreen;
  private readonly health: CallHealth;
  private readonly topology: CallTopology;
  private readonly settingsQueue: SettingsQueue;
  private readonly t: Translator;

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
    this.t = options.translate ?? translateForDocument;
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
          const person = this.people.get(id);
          if (!person) return;
          person.level = reading.level;
          person.speaking = reading.speaking;
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

    this.remoteAudio = new RemoteAudio({
      people: this.people,
      speech: this.speech,
      settings: () => this.settings,
      forgetOutputDevice: () => options.updateSettings?.({ outputDeviceId: null }),
      changed: () => this.publishPeers(),
    });
    this.personMedia = {
      remoteAudio: this.remoteAudio,
      changed: () => this.publishPeers(),
    };
    this.microphone = new LocalMicrophone({
      translate: this.t,
      selfUserId: options.selfUserId,
      store: this.store,
      speech: this.speech,
      links: () => this.topology.links(),
      applyEncoding: () => this.topology.applyMicEncoding(),
      rebuildLink: (link) => this.topology.rebuild(link),
      onDeviceLost: () => {
        void this.recaptureAfterDeviceLoss();
      },
    });
    this.health = new CallHealth({
      translate: this.t,
      realtime: options.realtime,
      ice: options.ice,
      store: this.store,
      bitrate: this.bitrate,
      statsIntervalMs: options.statsIntervalMs,
      activeSession: () => this.activeSession(),
      topology: () => this.topology,
    });
    const video: LocalVideoEnv = {
      translate: this.t,
      store: this.store,
      links: () => this.topology.links(),
      settings: () => this.settings,
      session: () => this.activeSession(),
      isStale: (session) => this.isStale(session),
      publish: () => this.publishPeers(),
      announce: () => {
        this.publishPeers();
        void this.broadcastState();
      },
      renegotiate: () => this.topology.renegotiate(),
    };
    this.camera = new LocalCamera({
      ...video,
      useSystemCamera: () => this.useSystemCamera(),
      recaptureCamera: (settings) =>
        this.settingsQueue.push({
          settings,
          recaptureMic: false,
          recaptureCamera: true,
          refreshPlayback: false,
        }),
    });
    this.screen = new LocalScreen(video);
    // `rtcIncompatibility` lets a call start with these two topologies only,
    // so whatever else the bootstrap says never gets a connection.
    this.topology =
      options.rtc.topology === "sfu" ? this.createSfu() : this.createMesh();
    this.settingsQueue = new SettingsQueue(
      (change) => this.applySettingsNow(change),
      () => this.disposed,
    );
    this.store.set({ cameraSupported: this.cameraIsSupported() });
  }

  private createMesh(): Mesh {
    const { options } = this;
    return new Mesh(this.people, {
      selfUserId: options.selfUserId,
      translate: this.t,
      store: this.store,
      ice: options.ice,
      preferences: this.preferences,
      remoteAudio: this.remoteAudio,
      microphone: this.microphone,
      camera: this.camera,
      screen: this.screen,
      recoveryGraceMs: options.recoveryGraceMs,
      settings: () => this.settings,
      bitrate: () => this.bitrate.getBitrate(),
      screenAudioStereo: () => this.screen.stereo,
      send: (signal) => this.send(signal),
      announceTo: (userId) => {
        void this.send({ kind: "state", toUserId: userId, payload: this.statePayload() });
      },
      receiveTrack: (person, track, stream) =>
        receiveRemoteTrack(this.personMedia, person, track, stream),
      session: () => this.session,
      activeSession: () => this.activeSession(),
      isStale: (session) => this.isStale(session),
      changed: () => this.publishPeers(),
      transportChanged: () => this.health.syncTransport(),
    });
  }

  private createSfu(): Sfu {
    const { options } = this;
    return new Sfu(this.people, {
      selfUserId: options.selfUserId,
      translate: this.t,
      store: this.store,
      realtime: options.realtime,
      ice: options.ice,
      preferences: this.preferences,
      remoteAudio: this.remoteAudio,
      personMedia: this.personMedia,
      microphone: this.microphone,
      camera: this.camera,
      screen: this.screen,
      recoveryGraceMs: options.recoveryGraceMs,
      replacementPauseMs: options.mediaReplacementPauseMs,
      settings: () => this.settings,
      bitrate: () => this.bitrate.getBitrate(),
      screenAudioStereo: () => this.screen.stereo,
      channelId: () => this.channelId,
      announceTo: (userId) => {
        void this.send({ kind: "state", toUserId: userId, payload: this.statePayload() });
      },
      activeSession: () => this.activeSession(),
      changed: () => this.publishPeers(),
      transportChanged: () => this.health.syncTransport(),
    });
  }

  getSnapshot = (): VoiceState => this.store.getSnapshot();

  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);

  // ---------------------------------------------------------------- session

  async join(channelId: ChannelId): Promise<void> {
    if (this.disposed) return;
    const incompatibility = rtcIncompatibility(this.t, this.options.rtc);
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
      cameraSupported: this.cameraIsSupported(),
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
      // Nobody is connected yet. That reads `ready` in the mesh, where a
      // correct join with nobody else needs no connection, and `connecting`
      // behind a media server, which this side has to reach first.
      transport: { signaling: "connecting", ...this.topology.transport() },
    });

    // Refresh the ICE configuration *before* anything can use it. The server's
    // TURN credentials last an hour and this tab may have been open for a day.
    let iceServers: RTCIceServer[];
    try {
      iceServers = await this.options.ice.beginSession();
    } catch (cause) {
      if (session === this.session) this.abortJoin(iceConfigError(this.t, cause));
      return;
    }
    if (this.isStale(session)) return;
    this.health.scheduleIceRefresh(session, iceServers);

    this.listen();
    this.lifecycle.start();

    try {
      await this.options.realtime.joinVoice(channelId);
    } catch {
      if (session === this.session) this.abortJoin(joinFailedError(this.t));
      return;
    }
    if (this.isStale(session)) return;

    this.markConnected();
    this.health.startStats();
    await this.topology.seated();
  }

  async leave(): Promise<void> {
    const wasJoined = this.channelId !== null;
    this.channelId = null;
    this.session += 1;

    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.topology.dropAll();

    this.health.stop();
    this.lifecycle.stop();
    this.bitrate.reset();
    this.camera.release();
    this.screen.release();
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
    const person = this.people.get(userId);
    const next = clampParticipantVolume(volume);
    if (!person || person.playbackVolume === next) return;
    person.playbackVolume = next;
    this.preferences.set(userId, { volume: next });
    this.remoteAudio.applyVolume(person);
    this.publishPeers();
  }

  setPeerGate(userId: UserId, gated: boolean): void {
    const person = this.people.get(userId);
    const next = Boolean(gated);
    if (!person || person.gated === next) return;
    person.gated = next;
    this.preferences.set(userId, { gated: next });
    this.remoteAudio.applyGate(person);
    this.publishPeers();
  }

  setPeerSuppression(userId: UserId, suppressed: boolean): void {
    const person = this.people.get(userId);
    const next = Boolean(suppressed);
    if (!person || person.suppressed === next) return;
    person.suppressed = next;
    this.preferences.set(userId, { suppressed: next });
    this.remoteAudio.applySuppression(person);
    this.publishPeers();
  }

  /** Must be called synchronously from the click, or the user gesture is lost. */
  startScreenShare(): Promise<void> {
    return this.screen.start();
  }

  stopScreenShare(): Promise<void> {
    return this.screen.stop();
  }

  startCamera(): Promise<void> {
    return this.camera.start();
  }

  stopCamera(): Promise<void> {
    return this.camera.stop();
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
      recaptureCamera: false,
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
      await this.topology.applyMicEncoding();
      // The fmtp ceiling lives in the SDP, so the profile change needs a pass.
      await this.topology.renegotiate();
    }

    if (previous.screenShareQuality !== next.screenShareQuality) {
      await this.screen.applyQuality(next.screenShareQuality);
    }
    await this.camera.follow(previous, next, change.recaptureCamera);

    if (this.channelId === null) return;
    const session = this.session;
    const swapped = await this.microphone.replace(
      next,
      change.recaptureMic,
      () => this.isStale(session) || this.supersedesCapture(next),
    );
    // A person who missed an earlier state frame is caught up by this one.
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
      recaptureCamera: false,
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
      recaptureCamera: false,
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
      return { capture: await captureMicrophone(settings, { translate: this.t }), settings };
    } catch (cause) {
      if (session !== this.session) return null;
      const retryable =
        settings.inputDeviceId !== null &&
        cause instanceof MicCaptureError &&
        cause.kind === "unavailable";
      if (!retryable) {
        this.abortJoin(micError(this.t, cause));
        return null;
      }
    }

    settings = { ...settings, inputDeviceId: null };
    this.settings = settings;
    this.options.updateSettings?.({ inputDeviceId: null });
    try {
      return { capture: await captureMicrophone(settings, { translate: this.t }), settings };
    } catch (cause) {
      if (session === this.session) this.abortJoin(micError(this.t, cause));
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
        if (event.channelId === this.channelId) void this.topology.reconcile(event.participants);
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
        if (signal.channelId !== this.channelId) return;
        if (signal.kind === "state") this.receiveState(signal);
        else void this.topology.handleSignal(signal);
      }),
      realtime.on("MediaSignal", (signal) => {
        if (signal.channelId === this.channelId) void this.topology.handleMediaSignal(signal);
      }),
      realtime.on("MediaSessionClosed", (event) => {
        if (event.channelId === this.channelId) this.topology.mediaSessionClosed(event);
      }),
      realtime.subscribeStatus(() => this.onRealtimeStatus()),
    );
  }

  /**
   * Another person's account of themselves. It travels from browser to
   * browser in every topology, so it is about the person and never about how
   * their media reaches this side.
   */
  private receiveState(signal: VoiceSignal): void {
    const from = signal.fromUserId;
    if (!from || from === this.options.selfUserId) return;
    const person = this.people.get(from);
    if (!person) return;
    try {
      const state = decodeRtcState(signal.payload);
      if (state) receiveRemoteState(this.personMedia, person, state);
    } catch {
      // A single bad frame must not tear down the session.
    }
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
   * target snapshot; only the connections and the people are dropped, because
   * they belong to the old room. Behind a media server the new seat then
   * opens a media session of its own.
   */
  private async followMove(targetChannelId: ChannelId): Promise<void> {
    if (this.channelId === null || this.channelId === targetChannelId) return;

    this.topology.dropAll();
    this.channelId = targetChannelId;
    this.store.set({
      channelId: targetChannelId,
      connection: "connecting",
      transport: {
        signaling: "connecting",
        media: this.microphone.capture === null ? "idle" : this.topology.transport().media,
        peerCount: 0,
        connectedPeerCount: 0,
      },
      error: null,
      peers: [this.selfPeer(this.selfSpeaking)],
    });

    try {
      await this.options.realtime.joinVoice(targetChannelId);
    } catch {
      if (this.channelId === targetChannelId) await this.endWithError(moveFailedError(this.t));
      return;
    }
    if (this.disposed || this.channelId !== targetChannelId) return;
    this.markConnected();
    // The seat in the new room needs a media session of its own.
    await this.topology.seated();
  }

  /**
   * Follow the hub without tearing down healthy media.
   *
   * In the mesh a SignalR reconnect says nothing about the peer connections:
   * they are direct, and they usually keep working perfectly while the hub is
   * away. So the state shows "reconnecting" for honesty, and on recovery we
   * rejoin the voice group and re-announce, rather than rebuilding anything
   * that is fine. Behind a media server the reconnect ended the seat and its
   * media session with it, so the rejoin opens a new one.
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
      if (session === this.session) this.store.set({ error: rejoinFailedError(this.t) });
      return;
    }
    if (this.isStale(session)) return;

    this.setSignaling("connected");
    this.store.set({ connection: "connected", error: null });
    // Whoever joined while we were away has no idea what our state is.
    void this.broadcastState();
    // The reconnect ended the seat, and with it a media session if there was
    // one; the mesh's direct connections outlive it.
    await this.topology.seated();
    await this.topology.repairUnhealthy();
  }

  private async send(signal: Omit<VoiceSignal, "channelId" | "protocolVersion">): Promise<void> {
    const channelId = this.channelId;
    if (!channelId) return;
    const session = this.session;
    if (signal.toUserId !== undefined && !this.people.has(signal.toUserId)) return;
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
        this.store.set({ error: signalingFailedError(this.t) });
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
      screenStreamId: this.screen.streamId,
      cameraStreamId: this.camera.streamId,
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
    await this.topology.repairUnhealthy();
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

  /** The session of the call in progress, or null when there is none to act in. */
  private activeSession(): number | null {
    return this.disposed || this.channelId === null ? null : this.session;
  }

  private cameraIsSupported(): boolean {
    return this.options.rtc.capabilities?.camera !== false && cameraIsSupported();
  }

  /** The chosen camera is gone: the system camera is the choice from now on. */
  private useSystemCamera(): VoiceSettings {
    if (this.settings.videoDeviceId !== null) {
      this.options.updateSettings?.({ videoDeviceId: null });
    }
    this.settings = { ...this.settings, videoDeviceId: null };
    return this.settings;
  }

  private abortJoin(error: VoiceError): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.camera.release();
    this.screen.release();
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
      screen: this.screen.local,
      camera: this.camera.local,
    };
  }

  private publishPeers(): void {
    this.store.set({
      peers: [
        this.selfPeer(this.selfSpeaking),
        ...[...this.people.values()].map((person) => ({
          userId: person.userId,
          displayName: person.displayName,
          muted: person.muted,
          speaking: person.speaking && !person.muted,
          level: person.level,
          playbackVolume: person.playbackVolume,
          gated: person.gated,
          suppressed: person.suppressed,
          self: false,
          screen: person.media.screen,
          camera: person.media.camera,
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
