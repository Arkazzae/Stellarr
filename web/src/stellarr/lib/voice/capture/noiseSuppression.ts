/**
 * Neural and DSP noise suppressors for the microphone path.
 *
 * Three engines, each a WASM binary driven by an AudioWorklet processor on the
 * render thread, so none of them competes with React for the main thread.
 * All are ours: artifacts/recipes/speex/, artifacts/recipes/rnnoise/ and
 * artifacts/recipes/gtcrn/ build their binaries from source, and their
 * processors, `speex/processor.ts`, `rnnoise/processor.ts` and
 * `gtcrn/processor.ts`, are built into /audio/speex-worklet.js,
 * /audio/rnnoise-worklet.js and /audio/gtcrn-worklet.js like the detector's.
 * All are served from /audio/ (see artifacts/manifest.json); this module is
 * the main-thread side that loads and starts them. Everything is loaded
 * lazily: the binaries weigh 61 KB (Speex), 3.6 MB (RNNoise, which holds its
 * network's weights) and 477 KB (GTCRN), and most sessions ask for exactly one.
 *
 * - `rnnoise`: Xiph's RNNoise with its newest model. Takes steady noise, keys
 *   and chewing out of the voice; it also takes out a whisper, which has no
 *   pitch for it to hear.
 * - `gtcrn`: a larger network with a far better record on non-stationary noise,
 *   at a higher CPU cost. The module takes 768-sample frames at 48 kHz,
 *   resamples them 3:1 and runs the model at 16 kHz, so the model itself sees
 *   nothing above 8 kHz. What lies above it is taken from the input, with a
 *   gain that follows what the model does to the top of its own band, so the
 *   voice keeps its top octave and the noise there goes with the model's.
 * - `speex`: SpeexDSP's `preprocess`, classic spectral subtraction. The lightest
 *   option and the least effective.
 *
 * Everything here degrades instead of failing. When the worklet, the WASM or the
 * node constructor gives out, `attachSuppressor` resolves to null and the
 * caller keeps the browser's own suppressor: a person who picked "GTCRN" and got
 * browser suppression is mildly disappointed, one whose call would not start
 * because a download failed is not on the call at all.
 */

import type { WorkletSuppressor } from "../audioProfiles";
import { GTCRN_WORKLET_URL } from "./gtcrn/address";
import { GTCRN_PROCESSOR_NAME, GTCRN_READY, type GtcrnOptions } from "./gtcrn/messages";
import { RNNOISE_WORKLET_URL } from "./rnnoise/address";
import { RNNOISE_PROCESSOR_NAME, RNNOISE_READY, type RnnoiseOptions } from "./rnnoise/messages";
import { SPEEX_WORKLET_URL } from "./speex/address";
import { SPEEX_PROCESSOR_NAME } from "./speex/messages";

export { GTCRN_WORKLET_URL, RNNOISE_WORKLET_URL };
export const RNNOISE_WASM_URL = "/audio/rnnoise.wasm";
export const GTCRN_WASM_URL = "/audio/gtcrn.wasm";
export { SPEEX_WORKLET_URL };
export const SPEEX_WASM_URL = "/audio/speex.wasm";

export const WORKLET_URL: Record<WorkletSuppressor, string> = {
  rnnoise: RNNOISE_WORKLET_URL,
  gtcrn: GTCRN_WORKLET_URL,
  speex: SPEEX_WORKLET_URL,
};

/** The name each worklet module registers its processor under. */
export const PROCESSOR_NAME: Record<WorkletSuppressor, string> = {
  rnnoise: RNNOISE_PROCESSOR_NAME,
  gtcrn: GTCRN_PROCESSOR_NAME,
  speex: SPEEX_PROCESSOR_NAME,
};

export type NoiseSuppressionStatus = "inactive" | "loading" | "active" | "unavailable";

export interface NoiseSuppressorHandle {
  /** Which engine is actually in the graph. */
  kind: WorkletSuppressor;
  /** The node carrying cleaned audio; the caller wires whatever comes next. */
  output: AudioNode;
  /** Idempotent; disconnects the worklet node and tells it to free its WASM heap. */
  dispose(): void;
}

/**
 * What the Speex processor reads from `processorOptions`, and all it reads:
 * the binary, which is copied into the render thread with the options and
 * compiled there. RNNoise's and GTCRN's take theirs compiled
 * (`RnnoiseOptions`, `GtcrnOptions`); see `startCompiled`.
 */
interface ProcessorOptions {
  wasmBinary: ArrayBuffer;
}

/**
 * The message a processor takes as its cue to stop processing and free its
 * WASM state. Disconnecting alone frees nothing: a processor without input
 * still reports itself alive and keeps its heap.
 *
 * Every engine's processor hears it: it frees the state, returns false from
 * then on and outputs silence. That matters most to the remote mixer, which
 * keeps one context, with a GTCRN in it for each voice, for the whole call;
 * the capture graph closes its context on every recapture.
 */
const DESTROY = "destroy";

/**
 * One binary per engine. RNNoise's and GTCRN's are built with WebAssembly
 * SIMD, which every browser that can load any of these binaries has (see
 * artifacts/recipes/rnnoise/build.sh), so there is no build without it to
 * fall back to.
 */
const WASM_URL: Record<WorkletSuppressor, () => string> = {
  rnnoise: () => RNNOISE_WASM_URL,
  gtcrn: () => GTCRN_WASM_URL,
  speex: () => SPEEX_WASM_URL,
};

/**
 * The binary, or a rejection. A response that is not a success is refused here:
 * its body would reach the worklet, fail to compile there off the main thread,
 * and leave a processor that keeps running and writes nothing, a microphone
 * gone silent instead of one falling back to the browser's suppressor.
 *
 * The body is read as a stream so `onBytes` can follow it. What it counts are
 * the bytes after the content encoding is undone; the response's
 * Content-Length counts them before, and nginx serves each binary as its
 * precompressed .gz, so no total is taken from the response.
 */
async function fetchBinary(
  url: string,
  onBytes: (received: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) {
    const whole = await response.arrayBuffer();
    onBytes(whole.byteLength);
    return whole;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onBytes(received);
  }
  const binary = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return binary.buffer;
}

/**
 * How long to wait for a processor to say it is ready. Constructing one took
 * about 1 ms in Chrome, so the answer comes within a few render quanta of the
 * context running; 3 s leaves room for a slow machine and a busy render
 * thread, and a context that is not running at all does not hold a capture up
 * for ever.
 */
const READY_TIMEOUT_MS = 3000;

/** What each engine whose binary is compiled here posts when its processor has a denoiser. */
const READY: Partial<Record<WorkletSuppressor, string>> = {
  rnnoise: RNNOISE_READY,
  gtcrn: GTCRN_READY,
};

/**
 * The node of an engine whose binary is compiled on the main thread, handed
 * back only once its processor has a denoiser: RNNoise's and GTCRN's.
 *
 * Their binaries are large, the weights of a network, and are compiled here
 * and handed over as a module, so that the processor only instantiates it.
 * Measured in Chrome (`npm run bench:voice-suppressor`, which prints it): for
 * RNNoise, compiling takes about 1.5 ms and the processor's constructor then
 * holds the render thread for about 1 ms (instantiating 0.5 to 1 ms, making
 * the state 0.1 to 0.2 ms), under half of a 2.67 ms render quantum, and no
 * render call came later than it did before the node existed. Compiling
 * inside the constructor would cost the render thread that much more; this
 * way it also costs it nothing when a module is handed to a second node.
 *
 * Waiting for the processor's word is what lets a failure fall back to the
 * browser's suppressor: a binary that does not compile rejects here, and a
 * processor that cannot instantiate it, short of memory say, fires
 * "processorerror" instead of saying it is ready. Chrome constructs the
 * processor whether or not the context is running. Until it is ready there is
 * no node to wire, so `attachSuppressor` has not resolved.
 */
async function startCompiled(
  kind: "rnnoise" | "gtcrn",
  context: AudioContext,
  wasmBinary: ArrayBuffer,
): Promise<AudioWorkletNode> {
  const module = await WebAssembly.compile(wasmBinary);
  const processorOptions: RnnoiseOptions | GtcrnOptions = { module };
  const node = new AudioWorkletNode(context, PROCESSOR_NAME[kind], { processorOptions });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === READY[kind]) resolve();
      };
      node.onprocessorerror = () => reject(new Error(`the ${kind} processor did not start`));
      // A suspended context or a stalled render thread never constructs the
      // processor, and nothing else would ever settle this.
      timer = setTimeout(() => reject(new Error(`the ${kind} processor did not say it was ready`)), READY_TIMEOUT_MS);
    });
  } catch (error) {
    // The node exists but nobody holds it: free whatever its processor made.
    try {
      node.port.postMessage(DESTROY);
      node.disconnect();
    } catch {
      // Already gone.
    }
    throw error;
  } finally {
    clearTimeout(timer);
    node.port.onmessage = null;
    node.onprocessorerror = null;
  }
  return node;
}

async function createNode(
  kind: WorkletSuppressor,
  context: AudioContext,
  wasmBinary: ArrayBuffer,
): Promise<AudioWorkletNode> {
  if (kind === "rnnoise" || kind === "gtcrn") return startCompiled(kind, context, wasmBinary);
  const processorOptions: ProcessorOptions = { wasmBinary };
  return new AudioWorkletNode(context, PROCESSOR_NAME[kind], { processorOptions });
}

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

const binaryCache = new Map<WorkletSuppressor, Promise<ArrayBuffer>>();
const registeredWorklets = new WeakMap<AudioContext, Map<WorkletSuppressor, Promise<void>>>();

/**
 * Where one engine's binary has got to. Each download is reported from the
 * moment it starts to one final phase, whoever started it: a capture, the
 * remote mixer, or a choice made ahead of any capture.
 */
export interface SuppressorDownloadEvent {
  kind: WorkletSuppressor;
  /** The file as served; which RNNoise build it is depends on the browser. */
  url: string;
  /** Bytes of the binary received so far. */
  received: number;
  phase: "loading" | "done" | "failed";
}

type DownloadWatcher = (event: SuppressorDownloadEvent) => void;

const downloadWatchers = new Set<DownloadWatcher>();

/** Hear about every binary download from now on; returns the way to stop. */
export function watchSuppressorDownloads(watcher: DownloadWatcher): () => void {
  downloadWatchers.add(watcher);
  return () => {
    downloadWatchers.delete(watcher);
  };
}

function report(event: SuppressorDownloadEvent): void {
  for (const watcher of [...downloadWatchers]) {
    try {
      watcher(event);
    } catch {
      // Whoever is watching cannot fail the download.
    }
  }
}

/**
 * The engine's binary, fetched once per page. The final phase is reported
 * after `remember` has evicted a failed load, so whoever hears "failed" and
 * asks again gets a new download rather than the same rejection.
 */
function loadBinary(kind: WorkletSuppressor): Promise<ArrayBuffer> {
  const cached = binaryCache.get(kind);
  if (cached) return cached;

  const url = WASM_URL[kind]();
  report({ kind, url, received: 0, phase: "loading" });
  const loading = remember(binaryCache, kind, () =>
    fetchBinary(url, (received) => report({ kind, url, received, phase: "loading" })),
  );
  loading.then(
    (binary) => report({ kind, url, received: binary.byteLength, phase: "done" }),
    () => report({ kind, url, received: 0, phase: "failed" }),
  );
  return loading;
}

/**
 * Fetch an engine's binary ahead of the capture that will need it, so the
 * capture finds it here. Resolves to whether it arrived. A failure is
 * evicted like any other, so the capture tries again and falls back to the
 * browser's suppressor as it always has.
 */
export function preloadSuppressor(kind: WorkletSuppressor): Promise<boolean> {
  return loadBinary(kind).then(
    () => true,
    () => false,
  );
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
function release(source: AudioNode, node: AudioWorkletNode): void {
  const steps = [
    () => source.disconnect(node),
    () => node.disconnect(),
    // Asks the processor to free its WASM heap; see DESTROY for when that
    // actually happens.
    () => node.port.postMessage(DESTROY),
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
  let node: AudioWorkletNode | null = null;
  try {
    await registerWorklet(kind, context);
    const wasmBinary = await loadBinary(kind);

    const created = await createNode(kind, context, wasmBinary);
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

/** Test seam: forget the cached binaries, and who was watching them, between cases. */
export function resetSuppressorCacheForTests(): void {
  binaryCache.clear();
  downloadWatchers.clear();
}
