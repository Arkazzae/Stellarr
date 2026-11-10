import {
  AdaptiveVad,
  LEVEL_STEPS,
  VAD_PROCESSOR_NAME,
  sensitivityToThresholds,
  // The worklet module is served verbatim from /public because an AudioWorklet
  // cannot load a bundled chunk. Importing the same file here means the
  // main-thread fallback and the worklet run byte-identical detection logic.
} from "../../../public/audio/vad-processor.js";

/** What the UI consumes. Nothing above this module knows about dBFS or SNR. */
export interface SpeechReading {
  speaking: boolean;
  /** 0..1, smoothed and quantised to the meter's steps. */
  level: number;
}

export type SpeechListener = (id: string, reading: SpeechReading) => void;

export interface SpeechDetectorOptions {
  /** 0..100, applied to tunable sources only. */
  sensitivity?: number;
}

export const VAD_WORKLET_URL = "/audio/vad-processor.js";

const DEFAULT_SENSITIVITY = 50;
/** Matches Opus, and makes the detector's 10 ms frame exactly 480 samples. */
const PREFERRED_SAMPLE_RATE = 48000;

type AudioContextConstructor = typeof AudioContext;

/**
 * How a source is being analysed. `pending` lasts while the worklet module
 * loads, so a source can be removed before its analysis ever starts.
 */
type Analysis =
  | { kind: "pending" }
  | { kind: "worklet"; node: AudioWorkletNode }
  | {
      kind: "analyser";
      node: AnalyserNode;
      vad: AdaptiveVad;
      samples: Float32Array<ArrayBuffer>;
    };

interface Source {
  input: MediaStreamAudioSourceNode;
  /** Only the local microphone follows the sensitivity dial. */
  tunable: boolean;
  analysis: Analysis;
  reading: SpeechReading;
}

function clampSensitivity(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SENSITIVITY;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? scope.webkitAudioContext ?? null;
}

function disconnectQuietly(node: AudioNode | null | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // Already detached.
  }
}

/**
 * Speaking detection for every stream in a call.
 *
 * Speaking state is derived locally from the audio itself instead of being
 * trusted from the peer, so the ring around an avatar always matches what you
 * can hear. Detection runs in an AudioWorklet on the audio render thread: it
 * sees every sample, a busy main thread cannot starve it, and it keeps running
 * in a background tab. The main thread is only woken when a reading changes.
 */
export class SpeechDetector {
  private context: AudioContext | null = null;
  private sink: GainNode | null = null;
  private workletModule: Promise<boolean> | null = null;
  private readonly sources = new Map<string, Source>();
  private frameHandle: number | null = null;
  private sensitivity: number;
  private disposed = false;

  constructor(
    private readonly onChange: SpeechListener,
    options: SpeechDetectorOptions = {},
  ) {
    this.sensitivity = clampSensitivity(options.sensitivity);
  }

  /**
   * Retune the local detector while someone is talking.
   *
   * The new thresholds are sent to the running detector instead of rebuilding
   * it: a fresh one would lose the learned noise floor and sit through its
   * 400 ms warm-up again, so the dial would feel dead after every step.
   */
  setSensitivity(sensitivity: number): void {
    const next = clampSensitivity(sensitivity);
    if (next === this.sensitivity) return;
    this.sensitivity = next;
    const config = sensitivityToThresholds(next);
    for (const { tunable, analysis } of this.sources.values()) {
      if (!tunable) continue;
      if (analysis.kind === "worklet") {
        analysis.node.port.postMessage({ type: "config", config });
      } else if (analysis.kind === "analyser") {
        analysis.vad.configure(config);
      }
    }
  }

  /** Create the audio context while the call-join click still carries user activation. */
  prepare(): void {
    const context = this.ensureContext();
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }

  /**
   * Bring the audio graph back after the tab was suspended.
   *
   * Chromium suspends an AudioContext in a backgrounded tab. Without this the
   * meter and the speaking ring stay frozen once the tab returns, although the
   * call itself is fine.
   */
  async resume(): Promise<boolean> {
    const context = this.context;
    if (!context || context.state === "closed") return false;
    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        // A context that refuses to resume is not worth failing the call over.
      }
    }
    // `state` is live: it may have changed while the promise was pending.
    return (context.state as AudioContextState) === "running";
  }

  /**
   * Start analysing a stream, replacing any earlier one under the same id.
   * Resolves false when nothing could be attached.
   *
   * `tunable` marks the local microphone. Remote participants are always judged
   * on the balanced profile, so one person's dial cannot change whether someone
   * else appears to be speaking.
   */
  async add(id: string, stream: MediaStream, tunable = false): Promise<boolean> {
    if (this.disposed || stream.getAudioTracks().length === 0) return false;
    const context = this.ensureContext();
    if (!context) return false;

    this.remove(id);

    let input: MediaStreamAudioSourceNode;
    try {
      input = context.createMediaStreamSource(stream);
    } catch {
      // Some browsers reject a stream whose track is not live yet.
      return false;
    }
    const source: Source = {
      input,
      tunable,
      analysis: { kind: "pending" },
      reading: { speaking: false, level: 0 },
    };
    this.sources.set(id, source);

    const workletReady = await this.loadWorkletModule(context);
    // remove() or dispose() ran while the module was loading and already
    // detached the input.
    if (this.sources.get(id) !== source) return false;

    const node = workletReady ? this.attachWorklet(context, id, source) : null;
    if (node) {
      source.analysis = { kind: "worklet", node };
      return true;
    }
    this.attachAnalyser(context, source);
    return true;
  }

  remove(id: string): void {
    const source = this.sources.get(id);
    if (!source) return;
    this.sources.delete(id);

    const { analysis } = source;
    if (analysis.kind === "worklet") this.stopWorklet(analysis.node);
    disconnectQuietly(source.input);
    if (analysis.kind !== "pending") disconnectQuietly(analysis.node);
    if (!this.hasAnalyserSource()) this.stopAnalyserLoop();
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.sources.keys()]) this.remove(id);
    disconnectQuietly(this.sink);
    this.sink = null;
    this.workletModule = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  // ---- audio graph ----

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.context) return this.context;
    const Context = audioContextConstructor();
    if (!Context) return null;
    let context: AudioContext;
    try {
      context = new Context({ sampleRate: PREFERRED_SAMPLE_RATE });
    } catch {
      // The browser may insist on the device rate; the detector adapts to it.
      context = new Context();
    }
    this.context = context;
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    return context;
  }

  /** A muted output: the graph only pulls nodes that reach the destination. */
  private ensureSink(context: AudioContext): GainNode {
    if (!this.sink) {
      const sink = context.createGain();
      sink.gain.value = 0;
      sink.connect(context.destination);
      this.sink = sink;
    }
    return this.sink;
  }

  private loadWorkletModule(context: AudioContext): Promise<boolean> {
    this.workletModule ??= (async () => {
      if (typeof AudioWorkletNode === "undefined" || !context.audioWorklet) {
        return false;
      }
      try {
        await context.audioWorklet.addModule(VAD_WORKLET_URL);
        return true;
      } catch {
        return false;
      }
    })();
    return this.workletModule;
  }

  // ---- worklet path ----

  /** Returns the connected node, or null when it could not be set up. */
  private attachWorklet(
    context: AudioContext,
    id: string,
    source: Source,
  ): AudioWorkletNode | null {
    let node: AudioWorkletNode | null = null;
    try {
      node = new AudioWorkletNode(context, VAD_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          sampleRate: context.sampleRate,
          // The local mic test needs levels below the speech threshold. Remote
          // people only need them while speaking; otherwise room noise would
          // wake React for no visible change.
          publishSilentLevels: source.tunable,
          ...(source.tunable ? sensitivityToThresholds(this.sensitivity) : {}),
        },
      });
      node.port.onmessage = (event: MessageEvent<SpeechReading>) => {
        this.publish(id, event.data);
      };
      source.input.connect(node);
      node.connect(this.ensureSink(context));
      return node;
    } catch {
      if (node) {
        this.stopWorklet(node);
        disconnectQuietly(source.input);
        disconnectQuietly(node);
      }
      return null;
    }
  }

  private stopWorklet(node: AudioWorkletNode): void {
    node.port.onmessage = null;
    try {
      node.port.postMessage({ type: "stop" });
    } catch {
      // The port may already be closed.
    }
  }

  // ---- analyser fallback ----

  /**
   * Degraded path for browsers without AudioWorklet. It runs the same detector
   * over analyser snapshots on the main thread, so heavy rendering can starve
   * it and a background tab stops it. That is acceptable for a path no
   * supported browser takes.
   */
  private attachAnalyser(context: AudioContext, source: Source): void {
    try {
      const node = context.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0;
      const vad = new AdaptiveVad({
        sampleRate: context.sampleRate,
        ...(source.tunable ? sensitivityToThresholds(this.sensitivity) : {}),
      });
      source.input.connect(node);
      source.analysis = {
        kind: "analyser",
        node,
        vad,
        samples: new Float32Array(vad.frameSize),
      };
      this.startAnalyserLoop();
    } catch {
      // Without Web Audio the level stays flat; voice itself still works.
    }
  }

  private hasAnalyserSource(): boolean {
    for (const { analysis } of this.sources.values()) {
      if (analysis.kind === "analyser") return true;
    }
    return false;
  }

  private startAnalyserLoop(): void {
    if (this.frameHandle !== null || typeof requestAnimationFrame !== "function") {
      return;
    }
    const tick = () => {
      this.frameHandle = requestAnimationFrame(tick);
      this.pumpAnalysers();
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  private stopAnalyserLoop(): void {
    if (this.frameHandle === null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
  }

  private pumpAnalysers(): void {
    for (const [id, { analysis }] of this.sources) {
      if (analysis.kind !== "analyser") continue;
      // An AnalyserNode only exposes its latest snapshot. Reading it several
      // times in one animation callback would repeat the same samples and turn
      // a single key click into consecutive "speech" frames, so each callback
      // analyses one frame.
      analysis.node.getFloatTimeDomainData(analysis.samples);
      const { speaking, level } = analysis.vad.processFrame(analysis.samples);
      this.publish(id, { speaking, level });
    }
  }

  // ---- output ----

  private publish(id: string, reading: SpeechReading): void {
    const source = this.sources.get(id);
    if (!source) return;
    const level =
      source.tunable || reading.speaking
        ? Math.round(reading.level * LEVEL_STEPS) / LEVEL_STEPS
        : 0;
    const previous = source.reading;
    if (previous.speaking === reading.speaking && previous.level === level) return;
    source.reading = { speaking: reading.speaking, level };
    this.onChange(id, source.reading);
  }
}
