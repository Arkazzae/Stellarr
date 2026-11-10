import { sensitivityToThresholds } from "../../../public/audio/vad-processor.js";
import { usesWorkletSuppression, type WorkletSuppressor } from "./audioProfiles";
import { buildGateNode } from "./gateNode";
import type { DetectorStages } from "./micCapture";
import { attachSuppressor, type NoiseSuppressorHandle } from "./noiseSuppression";
import { clampInputGain, type VoiceSettings } from "./settings";

/**
 * The Web Audio graph between the device and the peers:
 *
 *     device -> fixed gain -> [suppressor] -> detector (gate, leveller) -> peers
 *                                          \-> monitor (meter, speaking ring)
 *
 * The fixed gain comes first so a quiet microphone is lifted before the
 * suppressor judges it; the detector comes last so it judges cleaned audio.
 */

export interface GraphDeps {
  createContext?: () => AudioContext | null;
  attach?: typeof attachSuppressor;
  /** Builds the detector node (the gate, the leveller, or both). */
  createGate?: (
    context: AudioContext,
    sensitivity: number,
    stages: DetectorStages,
  ) => Promise<AudioWorkletNode | null>;
}

export interface CaptureGraph {
  track: MediaStreamTrack;
  stream: MediaStream;
  monitorStream: MediaStream;
  /** The suppressor that really came up, if any. */
  suppressor: WorkletSuppressor | null;
  gateActive: boolean;
  levelling: boolean;
  setSensitivity(sensitivity: number): void;
  setInputGain(db: number): void;
  fadeIn(): void;
  resume(): Promise<boolean>;
  /** Idempotent; releases every node and closes the context. */
  dispose(): void;
}

/** RNNoise and GTCRN consume fixed 10 ms frames, which are 480 samples only at 48 kHz. */
const CONTEXT_SAMPLE_RATE = 48_000;
/** How long a freshly built graph takes to reach its own level. */
const FADE_IN_SECONDS = 0.12;
/** A slider drag becomes a glide, not a run of zipper clicks. */
const GAIN_GLIDE_SECONDS = 0.02;

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function isRunning(context: AudioContext): boolean {
  return context.state === "running";
}

async function resumeContext(context: AudioContext): Promise<boolean> {
  if (isRunning(context)) return true;
  if (context.state === "closed") return false;
  try {
    await context.resume();
  } catch {
    // Autoplay policy or a torn-down device can reject. The caller either
    // retries from a gesture later or uses the raw browser-suppressed track.
  }
  return isRunning(context);
}

async function closeContext(context: AudioContext): Promise<void> {
  try {
    if (context.state !== "closed") await context.close();
  } catch {
    // Nothing useful to do; the page is likely going away.
  }
}

function openContext(createContext: GraphDeps["createContext"]): AudioContext | null {
  try {
    if (createContext) return createContext();
    if (typeof window === "undefined") return null;
    const scope = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Context = window.AudioContext ?? scope.webkitAudioContext;
    return Context ? new Context({ sampleRate: CONTEXT_SAMPLE_RATE }) : null;
  } catch {
    // Some Safari/device combinations reject a requested context sample rate.
    // The already-open raw microphone must stay usable and owned by the caller.
    return null;
  }
}

/**
 * A context that can carry the graph, or null (after closing it) when it cannot.
 *
 * A browser that ignored the requested rate would pitch- and time-warp the
 * suppression windows, and a context born suspended would send a valid but
 * permanently silent track. Both are worse than the browser's own processing.
 */
async function readyContext(
  createContext: GraphDeps["createContext"],
): Promise<AudioContext | null> {
  const context = openContext(createContext);
  if (!context) return null;
  const rate = context.sampleRate;
  const wrongRate = Number.isFinite(rate) && rate > 0 && rate !== CONTEXT_SAMPLE_RATE;
  if (!wrongRate && (await resumeContext(context))) return context;
  void closeContext(context);
  return null;
}

/** Releases are run newest first and each one tolerates having nothing left to do. */
function releaseAll(owned: Array<() => void>): void {
  for (const release of owned.splice(0).reverse()) {
    try {
      release();
    } catch {
      // Already detached or already stopped.
    }
  }
}

async function attempt<T>(build: () => Promise<T | null>): Promise<T | null> {
  try {
    return await build();
  } catch {
    return null;
  }
}

interface Assembly {
  gain: GainNode;
  suppressor: NoiseSuppressorHandle | null;
  detector: AudioWorkletNode | null;
  monitor: MediaStreamAudioDestinationNode | null;
  destination: MediaStreamAudioDestinationNode;
  track: MediaStreamTrack;
}

/**
 * Create and wire the nodes, registering how to undo each in `owned`.
 *
 * A suppressor or detector that fails to come up only leaves its stage out. It
 * resolves to null when nothing is left to justify a graph, or the destination
 * produced no track.
 */
async function assemble(
  context: AudioContext,
  raw: MediaStream,
  settings: VoiceSettings,
  stages: DetectorStages,
  deps: GraphDeps,
  owned: Array<() => void>,
): Promise<Assembly | null> {
  const source = context.createMediaStreamSource(raw);
  owned.push(() => source.disconnect());
  // Always present once there is a graph, so the slider can be retuned live: a
  // node added only when the value is non-zero would need a recapture the first
  // time the slider left zero.
  const gain = context.createGain();
  owned.push(() => gain.disconnect());
  gain.gain.value = dbToGain(settings.inputGainDb);
  source.connect(gain);

  const engine = usesWorkletSuppression(settings.noiseSuppression)
    ? settings.noiseSuppression
    : null;
  const attach = deps.attach ?? attachSuppressor;
  const suppressor = engine ? await attempt(() => attach(engine, context, gain)) : null;
  if (suppressor) owned.push(() => suppressor.dispose());

  const createGate = deps.createGate ?? buildGateNode;
  const detector =
    stages.gate || stages.leveller
      ? await attempt(() => createGate(context, settings.vadSensitivity, stages))
      : null;
  if (detector) {
    owned.push(() => detector.disconnect());
    owned.push(() => detector.port.postMessage({ type: "stop" }));
  }

  if (!suppressor && !detector && settings.inputGainDb === 0) return null;

  const createDestination = () => {
    const node = context.createMediaStreamDestination();
    owned.push(() => node.disconnect());
    owned.push(() => {
      for (const track of node.stream.getTracks()) track.stop();
    });
    return node;
  };

  const cleaned: AudioNode = suppressor ? suppressor.output : gain;
  // The meter and the speaking ring listen before the detector, the peers
  // after: the meter has to show the room even while the gate is shut, and
  // before the leveller so it shows what the device delivers.
  const monitor = detector ? createDestination() : null;
  if (monitor) cleaned.connect(monitor);
  const destination = createDestination();
  if (detector) {
    cleaned.connect(detector);
    detector.connect(destination);
  } else {
    cleaned.connect(destination);
  }

  const track = destination.stream.getAudioTracks()[0];
  return track ? { gain, suppressor, detector, monitor, destination, track } : null;
}

function controlsFor(
  context: AudioContext,
  assembly: Assembly,
  stages: DetectorStages,
  inputGainDb: number,
  teardown: () => void,
): CaptureGraph {
  const { gain, suppressor, detector, monitor, destination, track } = assembly;
  let gainTarget = dbToGain(inputGainDb);
  let disposed = false;

  return {
    track,
    stream: destination.stream,
    monitorStream: (monitor ?? destination).stream,
    suppressor: suppressor?.kind ?? null,
    gateActive: detector !== null && stages.gate,
    levelling: detector !== null && stages.leveller,
    setSensitivity(sensitivity) {
      if (disposed || !detector) return;
      try {
        detector.port.postMessage({
          type: "config",
          config: sensitivityToThresholds(sensitivity),
        });
      } catch {
        // The port is closed; the next recapture picks the value up anyway.
      }
    },
    setInputGain(db) {
      if (disposed) return;
      gainTarget = dbToGain(clampInputGain(db));
      const now = context.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(gainTarget, now, GAIN_GLIDE_SECONDS);
      } catch {
        gain.gain.value = gainTarget;
      }
    },
    fadeIn() {
      if (disposed) return;
      const now = context.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(gainTarget, now + FADE_IN_SECONDS);
      } catch {
        gain.gain.value = gainTarget;
      }
    },
    resume: () => resumeContext(context),
    dispose() {
      if (disposed) return;
      disposed = true;
      teardown();
    },
  };
}

/**
 * Build the graph for `raw`, or resolve to null when none could be built.
 *
 * Null leaves nothing behind: the context is closed and every node released, so
 * the caller can carry on with the raw device.
 */
export async function buildCaptureGraph(
  raw: MediaStream,
  settings: VoiceSettings,
  deps: GraphDeps,
): Promise<CaptureGraph | null> {
  const context = await readyContext(deps.createContext);
  if (!context) return null;

  const owned: Array<() => void> = [];
  const teardown = () => {
    releaseAll(owned);
    void closeContext(context);
  };
  const stages: DetectorStages = {
    gate: settings.inputGate,
    leveller: settings.autoGainControl,
  };

  try {
    const assembly = await assemble(context, raw, settings, stages, deps, owned);
    if (assembly) {
      return controlsFor(context, assembly, stages, settings.inputGainDb, teardown);
    }
  } catch {
    // A node the context refuses to create; fall through to the clean-up.
  }
  teardown();
  return null;
}
