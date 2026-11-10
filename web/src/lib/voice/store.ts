import { ChangeNotifier } from "@/lib/realtime/emitter";
import {
  IDLE_VOICE_STATE,
  type VoiceCamera,
  type VoiceDiagnostics,
  type VoicePeer,
  type VoiceScreenShare,
  type VoiceState,
  type VoiceTransportState,
} from "./types";

/**
 * Immutable snapshot holder shared by every `VoiceClient` implementation.
 * Snapshots are frozen and replaced only when something actually changed, so
 * `useSyncExternalStore` never re-renders on a no-op update.
 */
export class VoiceStateStore {
  private state: VoiceState = IDLE_VOICE_STATE;
  private readonly notifier = new ChangeNotifier();

  getSnapshot = (): VoiceState => this.state;

  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener);

  set(patch: Partial<VoiceState>): void {
    const next: VoiceState = { ...this.state, ...patch };
    if (isSameState(this.state, next)) return;
    this.state = Object.freeze(next);
    this.notifier.notify();
  }

  reset(): void {
    if (this.state === IDLE_VOICE_STATE) return;
    this.state = IDLE_VOICE_STATE;
    this.notifier.notify();
  }
}

function sameOptional<T>(a: T | null, b: T | null, same: (x: T, y: T) => boolean): boolean {
  return a === b || (a !== null && b !== null && same(a, b));
}

/** Rounds to the precision the UI shows; a missing reading is its own bucket. */
function bucket(value: number | null, perUnit: number): number {
  return Math.round((value ?? -1) * perUnit);
}

/**
 * Compares everything a component can render. `error.recoverable` is left out
 * on purpose: it never changes what is shown for the same kind and message.
 */
function isSameState(a: VoiceState, b: VoiceState): boolean {
  return (
    a.connection === b.connection &&
    a.channelId === b.channelId &&
    a.muted === b.muted &&
    a.error?.kind === b.error?.kind &&
    a.error?.message === b.error?.message &&
    a.screenSharePending === b.screenSharePending &&
    a.cameraPending === b.cameraPending &&
    a.cameraSupported === b.cameraSupported &&
    a.noiseSuppressionActive === b.noiseSuppressionActive &&
    a.degraded === b.degraded &&
    sameTransport(a.transport, b.transport) &&
    sameScreen(a.localScreen, b.localScreen) &&
    sameCamera(a.localCamera, b.localCamera) &&
    sameDiagnostics(a.diagnostics, b.diagnostics) &&
    samePeers(a.peers, b.peers)
  );
}

function sameTransport(a: VoiceTransportState, b: VoiceTransportState): boolean {
  return (
    a === b ||
    (a.signaling === b.signaling &&
      a.media === b.media &&
      a.peerCount === b.peerCount &&
      a.connectedPeerCount === b.connectedPeerCount)
  );
}

function sameScreen(a: VoiceScreenShare | null, b: VoiceScreenShare | null): boolean {
  return sameOptional(
    a,
    b,
    (x, y) => x.streamId === y.streamId && x.hasAudio === y.hasAudio && x.stream === y.stream,
  );
}

function sameCamera(a: VoiceCamera | null, b: VoiceCamera | null): boolean {
  return sameOptional(a, b, (x, y) => x.streamId === y.streamId && x.stream === y.stream);
}

function sameDiagnostics(a: VoiceDiagnostics, b: VoiceDiagnostics): boolean {
  return (
    a === b ||
    (a.quality === b.quality &&
      a.bitrate === b.bitrate &&
      // The readout shows whole percent and whole milliseconds, so finer
      // movement must not re-render the tree.
      bucket(a.lossFraction, 1000) === bucket(b.lossFraction, 1000) &&
      bucket(a.rttMs, 1) === bucket(b.rttMs, 1) &&
      a.bytesSent === b.bytesSent &&
      a.bytesReceived === b.bytesReceived &&
      a.packetsSent === b.packetsSent &&
      a.packetsReceived === b.packetsReceived)
  );
}

function samePeers(a: readonly VoicePeer[], b: readonly VoicePeer[]): boolean {
  return a === b || (a.length === b.length && a.every((peer, index) => samePeer(peer, b[index])));
}

function samePeer(a: VoicePeer, b: VoicePeer | undefined): boolean {
  return (
    b !== undefined &&
    a.userId === b.userId &&
    a.displayName === b.displayName &&
    a.muted === b.muted &&
    a.speaking === b.speaking &&
    a.playbackVolume === b.playbackVolume &&
    a.gated === b.gated &&
    a.suppressed === b.suppressed &&
    a.self === b.self &&
    sameScreen(a.screen, b.screen) &&
    sameCamera(a.camera, b.camera) &&
    // Eight steps are plenty for a level meter; jitter must not re-render.
    Math.round(a.level * 8) === Math.round(b.level * 8)
  );
}
