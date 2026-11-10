import type { WorkletSuppressor } from "./audioProfiles";

/** What is *actually* cleaning the microphone, not what was asked for. */
export type ActiveNoiseSuppression = WorkletSuppressor | "browser" | "none";

/**
 * What is *actually* levelling it. `worklet` is our own leveller in the graph;
 * `browser` means the graph could not be built and the platform AGC was
 * switched back on; `none` is not wanted, or wanted and not available.
 */
export type ActiveAutoGain = "worklet" | "browser" | "none";

/** Which jobs the detector node is built to do, besides detecting. */
export interface DetectorStages {
  gate: boolean;
  leveller: boolean;
}

export type MicFailureKind = "denied" | "unavailable" | "unsupported";

export class MicCaptureError extends Error {
  constructor(
    readonly kind: MicFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "MicCaptureError";
  }
}

/**
 * One object owns every disposable thing a capture creates: the raw device
 * track, the processed track, the graph nodes and, when a graph is on, the
 * AudioContext. Replacing the microphone mid-call is then a matter of building
 * a new one and disposing the old, with no way to leak a device handle. A
 * leaked raw track keeps the operating system's microphone indicator lit, which
 * reads to the person on the call as "this app is still listening".
 */
export interface MicCapture {
  /** What goes to the peers. Identical to the raw track unless a graph is on. */
  track: MediaStreamTrack;
  /** The stream carrying `track`. */
  stream: MediaStream;
  /**
   * What the local speaking detector and the settings meter should listen to.
   *
   * With a detector in the graph this is the audio *before* it: the meter has
   * to show the room even while nothing is being sent, and the ring has to
   * light from the same detector state that opens the gate, not from a stream
   * that is silent until the gate has already decided. Otherwise it is simply
   * `stream`.
   */
  monitorStream: MediaStream;
  /** The untouched device track, still the thing to mute and to stop. */
  rawTrack: MediaStreamTrack;
  /**
   * True when a Web Audio graph sits between the device and the peers: a
   * suppressor worklet, the gate, the leveller, a fixed gain, or several. A
   * suspended graph sends a valid but silent track, which is why the caller
   * needs to know.
   */
  processed: boolean;
  /**
   * Ground truth for the UI.
   *
   * When a worklet suppressor is requested the device is opened with the
   * browser's own suppressor **off**, because stacking two gates chews holes in
   * speech. If the worklet then fails to attach, that track is still running
   * unsuppressed, so saying "browser suppression is handling it" would be a
   * lie. The pipeline tries to switch the browser's suppressor back on, and
   * this field records whether that actually worked.
   */
  noiseSuppression: ActiveNoiseSuppression;
  /** True when the input gate was requested and is genuinely in the path. */
  gateActive: boolean;
  /** Which automatic volume is running, reported with the same honesty. */
  autoGain: ActiveAutoGain;
  /** Retune the gate's detector without rebuilding the graph. */
  setSensitivity(sensitivity: number): void;
  /** Retune the fixed gain without rebuilding the graph. No-op without one. */
  setInputGain(db: number): void;
  /**
   * Ramps this capture up from silence.
   *
   * Called by whoever puts the new track on the wire. Changing the suppressor
   * or the gate reopens the device and swaps the track underneath a live call;
   * without this the first thing everyone hears of the new graph is its own
   * hard start, a step from one signal to another and from one suppressor's
   * settled level to the next one's. No-op on a capture without a graph.
   */
  fadeIn(): void;
  /** Resume any processing graph after a background/browser suspension. */
  resume(): Promise<boolean>;
  /** Idempotent; stops the device and releases the graph. */
  dispose(): void;
}
