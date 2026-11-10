import type { UserId } from "@/lib/api/types";
import {
  cameraEncoding,
  captureCamera,
  CameraCaptureError,
  type CameraCapture,
  type CameraQualityId,
} from "./camera";
import {
  captureScreen,
  screenEncoding,
  screenTrackConstraints,
  type ScreenCapture,
  type ScreenRtpEncodingParameters,
  type ScreenShareQualityId,
} from "./screenShare";
import { screenVideoCodecList } from "./sdp";
import type { VoiceSettings } from "./settings";
import type { VoiceStateStore } from "./store";
import type { VoiceCamera, VoiceScreenShare } from "./types";
import {
  cameraError,
  cameraLostError,
  cameraSwapFailedError,
  screenQualityPartialError,
  screenShareError,
} from "./webrtcErrors";
import { sendEncodings, type Peer } from "./webrtcPeer";

/** What the camera and the screen share need from the call they are part of. */
export interface LocalVideoEnv {
  readonly store: VoiceStateStore;
  readonly peers: ReadonlyMap<UserId, Peer>;
  settings(): VoiceSettings;
  /** The session of the call being joined, or null when there is none. */
  session(): number | null;
  isStale(session: number): boolean;
  /** The local row changed: tell the UI. */
  publish(): void;
  /** What this client sends changed: tell the UI and everyone else. */
  announce(): void;
  /** Removing or replacing a sender takes a new offer. */
  renegotiate(): Promise<void>;
}

export interface LocalCameraEnv extends LocalVideoEnv {
  /** The chosen camera is gone: remember the system camera instead. */
  useSystemCamera(): VoiceSettings;
  /** Apply `settings` through the call's queue and reopen the camera whatever changed. */
  recaptureCamera(settings: VoiceSettings): Promise<void>;
}

/**
 * The camera this client sends: video only, one sender per peer.
 *
 * The capture owns the device, so a swap opens the new one before letting go
 * of the old, and a failed swap leaves the picture the others see untouched.
 */
export class LocalCamera {
  private capture: CameraCapture | null = null;

  constructor(private readonly env: LocalCameraEnv) {}

  /** The stream id announced to the others, or null while the camera is off. */
  get streamId(): string | null {
    return this.capture?.stream.id ?? null;
  }

  get local(): VoiceCamera | null {
    const stream = this.capture?.stream;
    return stream ? { streamId: stream.id, stream } : null;
  }

  async start(): Promise<void> {
    const { env } = this;
    const session = env.session();
    const { cameraSupported, cameraPending } = env.store.getSnapshot();
    if (session === null || this.capture || !cameraSupported || cameraPending) return;

    env.store.set({ cameraPending: true, error: null });
    const capture = await this.open(session);
    if (!capture) return;
    if (env.isStale(session)) {
      capture.dispose();
      return;
    }

    this.adopt(capture, session);
    for (const peer of env.peers.values()) this.addTo(peer);
    env.store.set({ cameraPending: false, localCamera: this.local });
    env.announce();
  }

  async stop(): Promise<void> {
    const capture = this.capture;
    if (!capture) return;
    this.capture = null;
    capture.video.onended = null;

    for (const peer of this.env.peers.values()) {
      peer.cameraSender = removeSender(peer, peer.cameraSender);
    }
    capture.dispose();
    this.env.store.set({ localCamera: null, cameraPending: false });
    this.env.announce();
    await this.env.renegotiate();
  }

  /** Put the camera on a connection that was just made. */
  addTo(peer: Peer): void {
    const capture = this.capture;
    if (!capture || peer.cameraSender) return;
    try {
      peer.cameraSender = peer.connection.addTrack(capture.video, capture.stream);
      void tuneCameraSender(peer.cameraSender, this.env.settings().cameraQuality);
    } catch {
      // A closing connection cannot take it; the rebuilt one will.
    }
  }

  /** Another device or quality means another capture; `force` asks for one regardless. */
  async follow(previous: VoiceSettings, next: VoiceSettings, force: boolean): Promise<void> {
    if (
      force ||
      previous.videoDeviceId !== next.videoDeviceId ||
      previous.cameraQuality !== next.cameraQuality
    ) {
      await this.replace(next);
    }
  }

  /** Stop the device without a word to the peers; the call is going away. */
  release(): void {
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    capture.video.onended = null;
    capture.dispose();
  }

  /**
   * Open the camera. A device id remembered from a camera that is gone must
   * not keep the camera from working: it is retried once on the system camera,
   * and that choice is remembered. A refusal is not retried, since a second
   * prompt cannot repair a denied origin. Null when it failed, which has been
   * reported, or when the call moved on meanwhile.
   */
  private async open(session: number): Promise<CameraCapture | null> {
    const { env } = this;
    const settings = env.settings();
    try {
      return await captureCamera(settings);
    } catch (cause) {
      if (env.isStale(session)) return null;
      const retryable =
        settings.videoDeviceId !== null &&
        cause instanceof CameraCaptureError &&
        cause.kind === "unavailable";
      if (!retryable) return this.fail(cause);
    }

    try {
      return await captureCamera(env.useSystemCamera());
    } catch (cause) {
      return env.isStale(session) ? null : this.fail(cause);
    }
  }

  private fail(cause: unknown): null {
    this.env.store.set({ cameraPending: false, error: cameraError(cause) });
    return null;
  }

  private adopt(capture: CameraCapture, session: number): void {
    this.capture = capture;
    capture.video.onended = () => {
      capture.video.onended = null;
      if (this.capture === capture) void this.recoverFromDeviceLoss(capture, session);
    };
  }

  private async recoverFromDeviceLoss(lost: CameraCapture, session: number): Promise<void> {
    await this.env.recaptureCamera(this.env.useSystemCamera());
    if (this.env.isStale(session) || this.capture !== lost) return;

    // No other camera could be opened. The call stays up, and the dead sender
    // goes rather than publishing a frozen tile for good.
    await this.stop();
    this.env.store.set({ error: cameraLostError });
  }

  private async replace(settings: VoiceSettings): Promise<void> {
    const { env } = this;
    const previous = this.capture;
    const session = env.session();
    if (!previous || session === null) return;
    const superseded = () => env.isStale(session) || this.capture !== previous;

    let capture: CameraCapture;
    try {
      capture = await captureCamera(settings);
    } catch (cause) {
      env.store.set({ error: cameraError(cause) });
      return;
    }
    if (superseded()) {
      capture.dispose();
      return;
    }

    const senders = [...env.peers.values()].flatMap((peer) =>
      peer.cameraSender ? [peer.cameraSender] : [],
    );
    const moves = await Promise.allSettled(senders.map((sender) => carry(sender, capture)));
    if (superseded()) {
      capture.dispose();
      return;
    }
    if (moves.some((move) => move.status === "rejected")) {
      await Promise.allSettled(
        senders.map((sender, index) =>
          moves[index]?.status === "fulfilled" ? carry(sender, previous) : undefined,
        ),
      );
      capture.dispose();
      env.store.set({ error: cameraSwapFailedError });
      return;
    }

    await Promise.all(senders.map((sender) => tuneCameraSender(sender, settings.cameraQuality)));
    previous.video.onended = null;
    this.adopt(capture, session);
    previous.dispose();
    const { error } = env.store.getSnapshot();
    env.store.set({ localCamera: this.local, error: error?.kind === "camera" ? null : error });
    env.announce();
    await env.renegotiate();
  }
}

/** The screen share this client sends: its picture and, when the picker gave one, its sound. */
export class LocalScreen {
  private capture: ScreenCapture | null = null;

  constructor(private readonly env: LocalVideoEnv) {}

  /** The stream id announced to the others, or null while nothing is shared. */
  get streamId(): string | null {
    return this.capture?.stream.id ?? null;
  }

  get local(): VoiceScreenShare | null {
    const capture = this.capture;
    return capture
      ? { streamId: capture.stream.id, hasAudio: capture.audio !== null, stream: capture.stream }
      : null;
  }

  /** Whether the shared sound has two channels, which decides how it is encoded. */
  get stereo(): boolean {
    return (this.capture?.audio?.getSettings().channelCount ?? 2) > 1;
  }

  /** Must run synchronously from the click, or the browser drops the user gesture. */
  async start(): Promise<void> {
    const { env } = this;
    const session = env.session();
    if (session === null || this.capture) return;

    env.store.set({ screenSharePending: true, error: null });
    let capture: ScreenCapture;
    try {
      capture = await captureScreen(undefined, env.settings().screenShareQuality);
    } catch (cause) {
      env.store.set({ screenSharePending: false, error: screenShareError(cause) });
      return;
    }
    if (env.isStale(session)) {
      stopTracks(capture);
      return;
    }

    this.capture = capture;
    // Exactly once, however the share ends: the browser's "Stop sharing" bar,
    // the shared window closing, or our own button.
    capture.video.onended = () => {
      capture.video.onended = null;
      void this.stop();
    };
    if (capture.audio) {
      capture.audio.onended = () => {
        void this.stopAudio(capture);
      };
    }

    for (const peer of env.peers.values()) this.addTo(peer);
    env.store.set({ screenSharePending: false, localScreen: this.local });
    env.announce();
  }

  async stop(): Promise<void> {
    const capture = this.capture;
    if (!capture) return;
    this.capture = null;
    capture.video.onended = null;
    if (capture.audio) capture.audio.onended = null;

    for (const peer of this.env.peers.values()) {
      peer.screenVideoSender = removeSender(peer, peer.screenVideoSender);
      peer.screenAudioSender = removeSender(peer, peer.screenAudioSender);
    }
    stopTracks(capture);
    this.env.store.set({ localScreen: null, screenSharePending: false });
    this.env.announce();
    await this.env.renegotiate();
  }

  /** Put the share on a connection that was just made. */
  addTo(peer: Peer): void {
    const capture = this.capture;
    if (!capture || peer.screenVideoSender) return;
    try {
      peer.screenVideoSender = peer.connection.addTrack(capture.video, capture.stream);
      if (capture.audio) {
        peer.screenAudioSender = peer.connection.addTrack(capture.audio, capture.stream);
      }
      void this.tune(peer, this.env.settings().screenShareQuality);
    } catch {
      // A closing connection cannot take it; the rebuilt one will.
    }
  }

  /** Apply a changed preset to the running share without ending or renegotiating it. */
  async applyQuality(quality: ScreenShareQualityId): Promise<void> {
    const capture = this.capture;
    if (!capture) return;

    let captureUpdated = true;
    try {
      if (typeof capture.video.applyConstraints === "function") {
        await capture.video.applyConstraints(screenTrackConstraints(quality));
      }
    } catch {
      captureUpdated = false;
    }
    const tuned = await Promise.all(
      [...this.env.peers.values()].map((peer) => this.tune(peer, quality)),
    );

    const { store } = this.env;
    if (captureUpdated && tuned.every(Boolean)) {
      if (store.getSnapshot().error?.kind === "screen-share") store.set({ error: null });
    } else {
      store.set({ error: screenQualityPartialError });
    }
  }

  /** Stop the capture without a word to the peers; the call is going away. */
  release(): void {
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    capture.video.onended = null;
    if (capture.audio) capture.audio.onended = null;
    stopTracks(capture);
  }

  /**
   * The picker's sound ended on its own; the picture carries on. The others
   * are told by the renegotiation: the share keeps its stream id, so the state
   * frame would say nothing new.
   */
  private async stopAudio(capture: ScreenCapture): Promise<void> {
    const audio = capture.audio;
    if (!audio || this.capture !== capture) return;
    audio.onended = null;
    capture.audio = null;

    for (const peer of this.env.peers.values()) {
      peer.screenAudioSender = removeSender(peer, peer.screenAudioSender);
    }
    this.env.store.set({ localScreen: this.local });
    this.env.publish();
    await this.env.renegotiate();
  }

  /**
   * VP9 first, then the encoder's ceiling for the preset. True when the browser
   * took the parameters; the codec order is an optimisation and never decides that.
   */
  private async tune(peer: Peer, quality: ScreenShareQualityId): Promise<boolean> {
    const sender = peer.screenVideoSender;
    if (!sender) return true;
    preferScreenCodecs(peer, sender);

    let parameters: RTCRtpSendParameters;
    try {
      parameters = sender.getParameters();
    } catch {
      return false;
    }
    const encodings = sendEncodings(parameters);
    for (const encoding of encodings) Object.assign(encoding, screenEncoding(quality));

    try {
      await sender.setParameters({
        ...parameters,
        encodings,
        // Shared desktops are sharp edges. Under pressure, frames go before
        // the resolution of text does.
        degradationPreference: "maintain-resolution",
      });
      return true;
    } catch {
      // Chromium takes a scalability mode for VP9, but older stacks reject it.
      // Without temporal layering the bitrate and frame-rate caps still apply.
      for (const encoding of encodings as ScreenRtpEncodingParameters[]) {
        delete encoding.scalabilityMode;
      }
      try {
        await sender.setParameters({ ...parameters, encodings });
        return true;
      } catch {
        return false;
      }
    }
  }
}

function preferScreenCodecs(peer: Peer, sender: RTCRtpSender): void {
  try {
    const transceiver = peer.connection.getTransceivers().find((item) => item.sender === sender);
    const capabilities =
      typeof RTCRtpSender !== "undefined" && RTCRtpSender.getCapabilities
        ? RTCRtpSender.getCapabilities("video")
        : null;
    const ordered = screenVideoCodecList(capabilities?.codecs);
    if (ordered && transceiver && typeof transceiver.setCodecPreferences === "function") {
      transceiver.setCodecPreferences(ordered);
    }
  } catch {
    // Codec preference is an optimisation, never a requirement.
  }
}

async function tuneCameraSender(sender: RTCRtpSender, quality: CameraQualityId): Promise<void> {
  if (typeof sender.getParameters !== "function") return;
  try {
    const parameters = sender.getParameters();
    const encodings = sendEncodings(parameters);
    for (const encoding of encodings) Object.assign(encoding, cameraEncoding(quality));
    await sender.setParameters({
      ...parameters,
      encodings,
      // A face in motion: a smooth picture matters more than a sharp one.
      degradationPreference: "maintain-framerate",
    });
  } catch {
    // Capture and negotiation work without sender tuning.
  }
}

/** Point a sender at another capture's picture and stream. */
async function carry(sender: RTCRtpSender, capture: CameraCapture): Promise<void> {
  await sender.replaceTrack(capture.video);
  sender.setStreams?.(capture.stream);
}

function removeSender(peer: Peer, sender: RTCRtpSender | null): null {
  if (sender) {
    try {
      peer.connection.removeTrack(sender);
    } catch {
      // A closing connection has already released it.
    }
  }
  return null;
}

function stopTracks(capture: ScreenCapture): void {
  for (const track of capture.stream.getTracks()) track.stop();
}
