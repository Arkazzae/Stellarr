/**
 * Neural and DSP noise suppressors for the microphone path.
 *
 * Three engines from one package (`@sapphi-red/web-noise-suppressor`), each a
 * WASM binary driven by an AudioWorklet on the render thread, so none of them
 * competes with React for the main thread. Everything is loaded lazily: the
 * binaries weigh 150-200 KB and most sessions ask for exactly one.
 *
 * - `rnnoise`: Xiph's RNNoise. Cheap and good on steady background noise, weak
 *   on impulsive sounds such as keys or chewing.
 * - `gtcrn`: a larger network with a far better record on non-stationary noise,
 *   at a higher CPU cost. It runs at 48 kHz natively, so it never band-limits
 *   the voice.
 * - `speex`: SpeexDSP's `preprocess`, classic spectral subtraction. The lightest
 *   option and the least effective.
 *
 * Everything here degrades instead of failing. When the worklet, the WASM or the
 * node constructor gives out, `attachSuppressor` resolves to null and the
 * caller keeps the browser's own suppressor: a person who picked "GTCRN" and got
 * browser suppression is mildly disappointed, one whose call would not start
 * because a download failed is not on the call at all.
 */

import type * as NoiseSuppressor from "@sapphi-red/web-noise-suppressor";

import type { WorkletSuppressor } from "./audioProfiles";

export const RNNOISE_WORKLET_URL = "/audio/rnnoise-worklet.js";
export const RNNOISE_WASM_URL = "/audio/rnnoise.wasm";
export const RNNOISE_SIMD_WASM_URL = "/audio/rnnoise_simd.wasm";
export const GTCRN_WORKLET_URL = "/audio/gtcrn-worklet.js";
export const GTCRN_WASM_URL = "/audio/gtcrn.wasm";
export const SPEEX_WORKLET_URL = "/audio/speex-worklet.js";
export const SPEEX_WASM_URL = "/audio/speex.wasm";

export const WORKLET_URL: Record<WorkletSuppressor, string> = {
  rnnoise: RNNOISE_WORKLET_URL,
  gtcrn: GTCRN_WORKLET_URL,
  speex: SPEEX_WORKLET_URL,
};

export type NoiseSuppressionStatus = "inactive" | "loading" | "active" | "unavailable";

export interface NoiseSuppressorHandle {
  /** Which engine is actually in the graph. */
  kind: WorkletSuppressor;
  /** The node carrying cleaned audio; the caller wires whatever comes next. */
  output: AudioNode;
  /** Idempotent; releases the worklet node and its WASM heap. */
  dispose(): void;
}

type Engine = typeof NoiseSuppressor;
type SuppressorNode = AudioWorkletNode & { destroy(): void };

interface EngineBinding {
  load(engine: Engine): Promise<ArrayBuffer>;
  create(engine: Engine, context: AudioContext, wasmBinary: ArrayBuffer): SuppressorNode;
}

const BINDINGS: Record<WorkletSuppressor, EngineBinding> = {
  rnnoise: {
    load: (engine) => engine.loadRnnoise({ url: RNNOISE_WASM_URL, simdUrl: RNNOISE_SIMD_WASM_URL }),
    create: (engine, context, wasmBinary) =>
      new engine.RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary }),
  },
  gtcrn: {
    load: (engine) => engine.loadGtcrn({ url: GTCRN_WASM_URL }),
    create: (engine, context, wasmBinary) =>
      new engine.GtcrnWorkletNode(context, { maxChannels: 1, wasmBinary }),
  },
  speex: {
    load: (engine) => engine.loadSpeex({ url: SPEEX_WASM_URL }),
    create: (engine, context, wasmBinary) =>
      new engine.SpeexWorkletNode(context, { maxChannels: 1, wasmBinary }),
  },
};

/**
 * Loads are cached as promises, so two captures starting together share one
 * download. A rejected load is evicted: a transient chunk or network failure
 * should cost one capture its suppressor, not pin the page to browser
 * suppression until reload.
 */
function remember<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const cached = cache.get(key);
  if (cached) return cached;
  const created = load();
  cache.set(key, created);
  created.catch(() => {
    if (cache.get(key) === created) cache.delete(key);
  });
  return created;
}

const engineCache = new Map<"engine", Promise<Engine>>();
const binaryCache = new Map<WorkletSuppressor, Promise<ArrayBuffer>>();
const registeredWorklets = new WeakMap<AudioContext, Map<WorkletSuppressor, Promise<void>>>();

function loadEngine(): Promise<Engine> {
  // Dynamic, so neither the wrapper nor its WASM glue lands in the main bundle
  // of the many sessions that never switch this on.
  return remember(engineCache, "engine", () => import("@sapphi-red/web-noise-suppressor"));
}

function registerWorklet(kind: WorkletSuppressor, context: AudioContext): Promise<void> {
  let registered = registeredWorklets.get(context);
  if (!registered) {
    registered = new Map();
    registeredWorklets.set(context, registered);
  }
  return remember(registered, kind, () => context.audioWorklet.addModule(WORKLET_URL[kind]));
}

/** Undo whatever of the node's wiring exists; every step tolerates having nothing to do. */
function release(source: AudioNode, node: SuppressorNode): void {
  const steps = [
    () => source.disconnect(node),
    () => node.disconnect(),
    // Frees the WASM instance's heap; skipping it leaks a few hundred
    // kilobytes per recapture.
    () => node.destroy(),
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      // Already detached, or only partly constructed.
    }
  }
}

/**
 * Insert a suppressor after `source`, or resolve to null when it is unavailable.
 *
 * The caller owns `context`; this adds one node to it and hands back a disposer
 * that removes exactly what it added. The caller connects `handle.output`
 * onward, to a gate, a destination, whatever comes next.
 */
export async function attachSuppressor(
  kind: WorkletSuppressor,
  context: AudioContext,
  source: AudioNode,
): Promise<NoiseSuppressorHandle | null> {
  let node: SuppressorNode | null = null;
  try {
    const engine = await loadEngine();
    await registerWorklet(kind, context);
    const binding = BINDINGS[kind];
    const wasmBinary = await remember(binaryCache, kind, () => binding.load(engine));

    const created = binding.create(engine, context, wasmBinary);
    node = created;
    source.connect(created);

    let disposed = false;
    return {
      kind,
      output: created,
      dispose() {
        if (disposed) return;
        disposed = true;
        release(source, created);
      },
    };
  } catch {
    // Construction can fail once the node exists and is partly wired; without
    // this every failed recapture would leak a WASM instance.
    if (node) release(source, node);
    return null;
  }
}

/** Test seam: forget the cached engine and binaries between cases. */
export function resetSuppressorCacheForTests(): void {
  engineCache.clear();
  binaryCache.clear();
}
