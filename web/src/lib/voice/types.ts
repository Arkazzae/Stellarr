import type { ChannelId, UserId } from "@/lib/api/types";

import type { NetworkQuality } from "./bitrate";
import type { VoiceSettings } from "./settings";

export type VoiceConnectionState =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export type VoiceSignalingState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type VoiceMediaState =
  | "idle"
  | "ready"
  | "connecting"
  | "connected"
  | "degraded"
  | "failed";

/**
 * Signaling and media health are tracked separately: SignalR can reconnect
 * while SRTP keeps flowing, and a healthy hub says nothing about whether a
 * peer connection ever established media.
 */
export interface VoiceTransportState {
  signaling: VoiceSignalingState;
  media: VoiceMediaState;
  peerCount: number;
  connectedPeerCount: number;
}

export const IDLE_VOICE_TRANSPORT: VoiceTransportState = Object.freeze({
  signaling: "idle",
  media: "idle",
  peerCount: 0,
  connectedPeerCount: 0,
});

export type VoiceErrorKind =
  | "mic-denied"
  | "mic-unavailable"
  | "unsupported"
  | "ice-config"
  | "signaling"
  | "transport"
  | "session-replaced"
  | "channel-kicked"
  | "camera"
  | "screen-share";

export interface VoiceError {
  kind: VoiceErrorKind;
  message: string;
  /** True when the call is still usable and only a sub-action failed. */
  recoverable?: boolean;
}

export interface VoiceScreenShare {
  /** Stable for as long as the share lasts. */
  streamId: string;
  hasAudio: boolean;
  /** Playable when this client owns or watches the share. */
  stream: MediaStream | null;
}

export interface VoiceCamera {
  /** Stable for as long as this capture is active. */
  streamId: string;
  stream: MediaStream | null;
}

export interface VoicePeer {
  userId: UserId;
  displayName: string;
  muted: boolean;
  speaking: boolean;
  /** Smoothed input level, 0..1. */
  level: number;
  /** Receiver-side volume for this participant, 0 to 200. */
  playbackVolume: number;
  /** Local only: this person's strip is muted between words. */
  gated: boolean;
  /** Local only: this person's strip is denoised before the gate. */
  suppressed: boolean;
  self: boolean;
  /** Null when the participant is not sharing a screen. */
  screen: VoiceScreenShare | null;
  /** Null when the participant's camera is off. */
  camera: VoiceCamera | null;
}

/** Coarse, non-alarming call health for the dock. */
export interface VoiceDiagnostics {
  quality: NetworkQuality;
  /** Current send ceiling in bits per second; null before the first sample. */
  bitrate: number | null;
  /** 0..1 */
  lossFraction: number | null;
  rttMs: number | null;
  /** Cumulative audio RTP counters of the connection to the media server. */
  bytesSent: number;
  bytesReceived: number;
  packetsSent: number;
  packetsReceived: number;
}

export const IDLE_DIAGNOSTICS: VoiceDiagnostics = Object.freeze({
  quality: "unknown",
  bitrate: null,
  lossFraction: null,
  rttMs: null,
  bytesSent: 0,
  bytesReceived: 0,
  packetsSent: 0,
  packetsReceived: 0,
});

export interface VoiceState {
  connection: VoiceConnectionState;
  transport: VoiceTransportState;
  channelId: ChannelId | null;
  muted: boolean;
  peers: VoicePeer[];
  error: VoiceError | null;
  /** The local share, when this user is the one sharing. */
  localScreen: VoiceScreenShare | null;
  /** True while `startScreenShare` waits on the picker. */
  screenSharePending: boolean;
  /** The local camera preview and published stream. */
  localCamera: VoiceCamera | null;
  /** True while permission and device capture are being resolved. */
  cameraPending: boolean;
  /** Browser capability, independent of whether a call is joined. */
  cameraSupported: boolean;
  /** True when RNNoise was requested and is actually running. */
  noiseSuppressionActive: boolean;
  /** Set when a requested processing mode silently degraded. */
  degraded: string | null;
  diagnostics: VoiceDiagnostics;
}

export const IDLE_VOICE_STATE: VoiceState = Object.freeze({
  connection: "idle",
  transport: IDLE_VOICE_TRANSPORT,
  channelId: null,
  muted: false,
  peers: [],
  error: null,
  localScreen: null,
  screenSharePending: false,
  localCamera: null,
  cameraPending: false,
  cameraSupported: false,
  noiseSuppressionActive: false,
  degraded: null,
  diagnostics: IDLE_DIAGNOSTICS,
});

/**
 * The only RTC surface the UI may touch. Signaling, the connection to the
 * media server and everything else of WebRTC sit behind it and can change
 * without touching a component. Snapshots are immutable and referentially stable between
 * changes, so `getSnapshot` and `subscribe` plug straight into
 * `useSyncExternalStore`.
 */
export interface VoiceClient {
  getSnapshot(): VoiceState;
  subscribe(listener: () => void): () => void;
  join(channelId: ChannelId): Promise<void>;
  leave(): Promise<void>;
  /**
   * Repair the call in progress without leaving it: the others never see this
   * person go. A call that has no seat joins again.
   */
  reconnect(): Promise<void>;
  setMuted(muted: boolean): void;
  /** Silences or restores every remote voice and screen sink; capture is unaffected. */
  setDeafened(deafened: boolean): void;
  /** Local only; never signalled to the peer. */
  setPeerVolume(userId: UserId, volume: number): void;
  /**
   * Gates one remote microphone strip so what that person sends between
   * words never reaches your ears. Local only; never signalled to the peer.
   */
  setPeerGate(userId: UserId, gated: boolean): void;
  /**
   * Runs one remote microphone strip through a local noise suppressor, for a
   * person whose own settings you cannot change. Local only; costs this
   * browser the CPU, for that one strip.
   */
  setPeerSuppression(userId: UserId, suppressed: boolean): void;
  /**
   * Applies changed settings to a live call. Replaces the outgoing track on
   * the connection when a capture-affecting setting changed, without dropping
   * the call.
   */
  applySettings(settings: VoiceSettings): Promise<void>;
  /** Must be called synchronously from the click, or the user gesture is lost. */
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  startCamera(): Promise<void>;
  stopCamera(): Promise<void>;
  dispose(): void;
}
