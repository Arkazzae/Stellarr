/**
 * The suppressor comparison's page. run.mjs builds it with Vite, opens it
 * in Chrome and calls `window.__suppressor`.
 *
 * "After" is the app as it is: `attachSuppressor` loads the engine's worklet
 * and binary from /audio/, exactly as a call does. "Before" is a worklet and
 * a binary the runner serves at /before/, started the way the app started
 * the published worklets: the processor name its registerProcessor call
 * gives, and `{ maxChannels: 1, wasmBinary, module }`, which the published
 * worklets and ours each read what they need from. Both render the same fixture
 * in an OfflineAudioContext at 48 kHz, one mono channel.
 */
import {
  PROCESSOR_NAME,
  attachSuppressor,
  resetSuppressorCacheForTests,
  type NoiseSuppressorHandle,
} from "@/lib/voice/capture/noiseSuppression";
import type { WorkletSuppressor } from "@/lib/voice/audioProfiles";
import { GtcrnDenoiser, instantiateGtcrn } from "@/lib/voice/capture/gtcrn/denoiser";
import { RnnoiseDenoiser, instantiateRnnoise } from "@/lib/voice/capture/rnnoise/denoiser";
import { REMOTE_SUPPRESSOR, RemoteVoiceMixer } from "@/lib/voice/playback/remoteMixer";
import { measureLatency } from "../capture/record";
import { QUANTUM, SAMPLE_RATE } from "../dsp";
import { LATENCY_PROBE, TALKERS, buildFixture, fixtureByName } from "../fixtures";
import { decodeWav } from "../wav";
import { ROOMS, measure, mixtures, type Measures } from "./quality";

declare global {
  interface Window {
    __suppressor?: unknown;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The published worklets compile their binary asynchronously and output
 * silence until it is ready. A render that started before that would put
 * the two engines' states on different frames, so each render waits this
 * long after the nodes exist, and reports the first sample each one sounded
 * so that a start that was still too early shows.
 */
const SETTLE_MS = 500;

interface Before {
  processor: string;
  binary: ArrayBuffer;
}

let before: Before | null = null;

async function loadBefore(): Promise<Before> {
  if (before) return before;
  const code = await (await fetch("/before/worklet.js")).text();
  const processor = /registerProcessor\(\s*[`'"]([^`'"]+)[`'"]/.exec(code)?.[1];
  if (!processor) throw new Error("the worklet at /before/worklet.js registers no processor");
  const binary = await (await fetch("/before/binary.wasm")).arrayBuffer();
  before = { processor, binary };
  return before;
}

type Side = "before" | "after";

interface Rendered {
  output: Float32Array;
  firstSound: number;
  /** Wall time of the render itself, in ms. */
  ms: number;
}

function firstSound(samples: Float32Array): number {
  for (let i = 0; i < samples.length; i += 1) if (samples[i] !== 0) return i;
  return -1;
}

/** One side's node in `context`, fed by `source`. */
async function node(side: Side, kind: WorkletSuppressor, context: OfflineAudioContext, source: AudioNode) {
  if (side === "after") {
    const handle = await attachSuppressor(kind, context as unknown as AudioContext, source);
    if (!handle) throw new Error(`attachSuppressor gave no ${kind} suppressor`);
    return { output: handle.output as AudioWorkletNode, handle };
  }
  const { processor, binary } = await loadBefore();
  await context.audioWorklet.addModule("/before/worklet.js");
  // The published worklets read the binary; ours for RNNoise and GTCRN take
  // it compiled, so that an earlier build of either can stand on this side too.
  const created = new AudioWorkletNode(context, processor, {
    processorOptions: { maxChannels: 1, wasmBinary: binary.slice(0), module: await WebAssembly.compile(binary) },
  });
  source.connect(created);
  return { output: created, handle: null as NoiseSuppressorHandle | null };
}

/**
 * `input` through one side. With `destroyAt`, the render stops there, the
 * node is sent the app's "destroy" without being disconnected, and goes on.
 */
async function render(side: Side, kind: WorkletSuppressor, input: Float32Array, destroyAt?: number): Promise<Rendered> {
  const context = new OfflineAudioContext(1, input.length, SAMPLE_RATE);
  const buffer = context.createBuffer(1, input.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(input);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const { output } = await node(side, kind, context, source);
  output.connect(context.destination);
  source.start();
  await sleep(SETTLE_MS);
  if (destroyAt !== undefined) {
    void context.suspend(destroyAt / SAMPLE_RATE).then(async () => {
      output.port.postMessage("destroy");
      await sleep(SETTLE_MS);
      await context.resume();
    });
  }
  const started = performance.now();
  const rendered = await context.startRendering();
  const ms = performance.now() - started;
  const samples = rendered.getChannelData(0).slice();
  return { output: samples, firstSound: firstSound(samples), ms };
}

/** How long `input` takes to render through a gain of one: the part of a render no engine adds. */
async function renderPlain(input: Float32Array): Promise<number> {
  const context = new OfflineAudioContext(1, input.length, SAMPLE_RATE);
  const buffer = context.createBuffer(1, input.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(input);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.createGain()).connect(context.destination);
  source.start();
  const started = performance.now();
  await context.startRendering();
  return performance.now() - started;
}

async function latency(side: Side, kind: WorkletSuppressor): Promise<number | null> {
  const probe = LATENCY_PROBE.build();
  const { output } = await render(side, kind, probe);
  return measureLatency(probe, output, {
    start: LATENCY_PROBE.windowStart,
    length: LATENCY_PROBE.windowLength,
    maxDelay: LATENCY_PROBE.maxDelay,
  });
}

function energy(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (samples[i] as number) ** 2;
  return sum;
}

const db = (value: number) => (value > 0 ? 10 * Math.log10(value) : -Infinity);

export interface FixtureComparison {
  fixture: string;
  samples: number;
  firstSound: { before: number; after: number };
  /** Samples of the after side's output that differ from the before side's, aligned by latency. */
  differing: number;
  largest: number;
  /** RMS of the difference, in dBFS and in dB against the before side's output. */
  differenceDbfs: number;
  differenceDb: number;
  outputDbfs: { before: number; after: number };
}

/** Hands samples to the runner, which writes them as a WAV file for listening. */
async function keep(file: string, samples: Float32Array): Promise<void> {
  const response = await fetch(`/__output/${encodeURIComponent(file)}`, { method: "POST", body: samples.slice() });
  if (!response.ok) throw new Error(`the runner did not take ${file}`);
}

/**
 * Each fixture through both sides, compared sample by sample once aligned by
 * latency. With `write`, the input and both outputs go to the runner too.
 */
async function compare(kind: WorkletSuppressor, fixtures: string[], write = false) {
  // The current side first: the runner serves the earlier binary for the
  // path the current side fetched.
  const after = await latency("after", kind);
  const latencies = { before: await latency("before", kind), after };
  const shift = (latencies.after ?? 0) - (latencies.before ?? 0);
  const results: FixtureComparison[] = [];
  for (const name of fixtures) {
    const input = buildFixture(fixtureByName(name));
    const a = await render("before", kind, input);
    const b = await render("after", kind, input);
    if (write) {
      await keep(`${name}.input`, input);
      await keep(`${name}.before`, a.output);
      await keep(`${name}.now`, b.output);
    }
    let differing = 0;
    let largest = 0;
    let sum = 0;
    const from = Math.max(0, -shift);
    const to = Math.min(a.output.length, b.output.length - shift);
    for (let i = from; i < to; i += 1) {
      const difference = Math.abs((b.output[i + shift] as number) - (a.output[i] as number));
      if (difference > 0) differing += 1;
      if (difference > largest) largest = difference;
      sum += difference * difference;
    }
    const count = Math.max(1, to - from);
    results.push({
      fixture: name,
      samples: input.length,
      firstSound: { before: a.firstSound, after: b.firstSound },
      differing,
      largest,
      differenceDbfs: db(sum / count),
      differenceDb: db(sum) - db(energy(a.output, from, to)),
      outputDbfs: { before: db(energy(a.output) / a.output.length), after: db(energy(b.output) / b.output.length) },
    });
  }
  return { latencies, results };
}

/**
 * Whether "destroy" silences each side: noise from the first sample, the
 * message half way through, and the output after it a quantum later.
 */
async function destroyed(kind: WorkletSuppressor) {
  const input = buildFixture(fixtureByName("fan"));
  const at = Math.floor(input.length / 2 / QUANTUM) * QUANTUM;
  const check = async (side: Side) => {
    const { output } = await render(side, kind, input, at);
    const after = output.subarray(at + QUANTUM);
    return { soundBefore: energy(output, 0, at) > 0, silentAfter: energy(after) === 0 };
  };
  return { before: await check("before"), after: await check("after") };
}

export interface MixtureResult {
  name: string;
  talker: string;
  room: string;
  recorded: boolean;
  seconds: number;
  before: Measures;
  after: Measures;
  /** Render time each side added over a plain render, in ms per 10 ms of audio. */
  cost: { before: number; after: number };
}

/** The talkers: the synthetic ones of fixtures.ts and every recording the runner serves. */
async function talkers() {
  const out = TALKERS.map((talker) => ({ name: talker.name, samples: talker.build(), recorded: false }));
  const names = (await (await fetch("/__recordings")).json()) as string[];
  for (const name of names) {
    const wav = decodeWav(new Uint8Array(await (await fetch(`/__recordings/${encodeURIComponent(name)}`)).arrayBuffer()));
    if (wav.sampleRate !== SAMPLE_RATE) throw new Error(`${name} is at ${wav.sampleRate} Hz, not ${SAMPLE_RATE}`);
    out.push({ name: name.replace(/\.wav$/, "").toLowerCase(), samples: wav.samples, recorded: true });
  }
  return out;
}

/**
 * Every talker in every room through both sides, measured against the clean
 * talker (quality.ts), or only the mixtures named in `only`. With `write`,
 * the input, the clean talker and both outputs go to the runner too.
 */
async function quality(kind: WorkletSuppressor, write = false, only: string[] | null = null) {
  const results: MixtureResult[] = [];
  for (const mixture of mixtures(await talkers())) {
    if (only !== null && !only.includes(mixture.name)) continue;
    const plain = await renderPlain(mixture.input);
    const a = await render("before", kind, mixture.input);
    const b = await render("after", kind, mixture.input);
    if (write) {
      await keep(`${mixture.name}.input`, mixture.input);
      await keep(`${mixture.name}.clean`, mixture.clean);
      await keep(`${mixture.name}.before`, a.output);
      await keep(`${mixture.name}.now`, b.output);
    }
    const frames = mixture.input.length / 480;
    results.push({
      name: mixture.name,
      talker: mixture.talker,
      room: mixture.room,
      recorded: mixture.recorded,
      seconds: mixture.input.length / SAMPLE_RATE,
      before: measure(mixture, a.output),
      after: measure(mixture, b.output),
      cost: { before: (a.ms - plain) / frames, after: (b.ms - plain) / frames },
    });
  }
  return { rooms: ROOMS.map(({ name, label }) => ({ name, label })), results };
}

/**
 * A node that passes its input through, records it, and notes every gap of
 * 6 ms or more between two of its render calls (a quantum is 2.7 ms): a
 * context renders all its nodes on one thread, so a node built while this
 * one runs shows up as a gap in its calls.
 */
const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.first = -1;
    this.last = 0;
    this.gaps = [];
    this.port.onmessage = () => {
      this.port.postMessage({ first: this.first, gaps: this.gaps, samples: this.chunks });
    };
  }
  process(inputs, outputs) {
    const now = Date.now();
    if (this.last !== 0 && now - this.last >= 6) this.gaps.push([now, now - this.last]);
    this.last = now;
    const input = inputs[0][0];
    if (input) {
      if (this.first < 0) this.first = currentFrame;
      this.chunks.push(input.slice());
      outputs[0][0].set(input);
    }
    return true;
  }
}
registerProcessor("bench-tap", Tap);
`;

interface TapReport {
  first: number;
  gaps: Array<[number, number]>;
  samples: Float32Array[];
}

async function tapReport(node: AudioWorkletNode): Promise<TapReport> {
  return new Promise((resolve) => {
    node.port.onmessage = (event: MessageEvent<TapReport>) => resolve(event.data);
    node.port.postMessage("report");
  });
}

/**
 * What a processor's constructor does to the render thread, timed here on the
 * main thread, which runs the same engine: instantiating a module that was
 * compiled elsewhere (what compiling takes is reported too: it would be the
 * render thread's if the processor compiled), making the state, and then the
 * first quanta, whose code may not have been optimised yet. A render quantum
 * is 2.67 ms.
 */
interface Construction {
  url: string;
  instantiate(module: WebAssembly.Module): unknown;
  make(exports: unknown): { run(input: Float32Array, output: Float32Array): void; destroy(): void };
}

const CONSTRUCTION: Partial<Record<WorkletSuppressor, Construction>> = {
  rnnoise: {
    url: "/audio/rnnoise.wasm",
    instantiate: instantiateRnnoise,
    make: (exports) => new RnnoiseDenoiser(exports as ReturnType<typeof instantiateRnnoise>),
  },
  gtcrn: {
    url: "/audio/gtcrn.wasm",
    instantiate: instantiateGtcrn,
    make: (exports) => new GtcrnDenoiser(exports as ReturnType<typeof instantiateGtcrn>),
  },
};

async function construction(kind: WorkletSuppressor) {
  const engine = CONSTRUCTION[kind];
  if (engine === undefined) return null;
  const binary = await (await fetch(engine.url)).arrayBuffer();
  let started = performance.now();
  const module = await WebAssembly.compile(binary);
  const compileMs = performance.now() - started;
  started = performance.now();
  const exports = engine.instantiate(module);
  const instantiateMs = performance.now() - started;
  started = performance.now();
  const denoiser = engine.make(exports);
  const createMs = performance.now() - started;
  const talker = TALKERS[0]?.build() ?? new Float32Array(0);
  const output = new Float32Array(QUANTUM);
  const times: number[] = [];
  for (let at = 0; at + QUANTUM <= talker.length && times.length < 400; at += QUANTUM) {
    started = performance.now();
    denoiser.run(talker.subarray(at, at + QUANTUM), output);
    times.push(performance.now() - started);
  }
  denoiser.destroy();
  const largest = (values: number[]) => Math.max(...values);
  return { compileMs, instantiateMs, createMs, firstQuantaMs: largest(times.slice(0, 40)), laterQuantaMs: largest(times.slice(200)) };
}

/**
 * The engine in a real-time AudioContext, through attachSuppressor as the
 * app calls it: a talker played through it must come out as sound, and the
 * render thread must keep its pace while the node is built. A second tap,
 * fed by an oscillator and unconnected to the engine, notes the gaps in the
 * render calls; `attachMs` is the time on the main thread, compile included.
 */
async function realtime(kind: WorkletSuppressor) {
  resetSuppressorCacheForTests();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  await context.resume();
  const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
  await context.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const clock = new AudioWorkletNode(context, "bench-tap");
  const pace = context.createOscillator();
  pace.connect(clock).connect(context.destination);
  pace.start();

  const talker = TALKERS[0]?.build() ?? new Float32Array(0);
  const buffer = context.createBuffer(1, talker.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(talker);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const tap = new AudioWorkletNode(context, "bench-tap");
  tap.connect(context.destination);

  await sleep(500);
  const startedAt = Date.now();
  const handle = await attachSuppressor(kind, context, source);
  const attachMs = Date.now() - startedAt;
  if (handle === null) {
    await context.close();
    return { attached: false };
  }
  handle.output.connect(tap);
  const playedFrom = context.currentTime;
  source.start();
  await sleep(3000);

  const paceReport = await tapReport(clock);
  const heard = await tapReport(tap);
  handle.dispose();
  await context.close();

  const flat = new Float32Array(heard.samples.length * QUANTUM);
  heard.samples.forEach((chunk, index) => flat.set(chunk, index * QUANTUM));
  // From a second after the talker starts: past the engine's own delay.
  const from = Math.round((playedFrom + 1) * SAMPLE_RATE) - heard.first;
  const window = flat.subarray(Math.max(0, from));
  return {
    attached: true,
    construction: await construction(kind),
    attachMs,
    soundDb: db(energy(window) / Math.max(1, window.length)),
    // Gaps in the pace tap's render calls from the moment attach began until 300 ms after it resolved.
    gapsDuringAttach: paceReport.gaps.filter(([at]) => at >= startedAt && at <= startedAt + attachMs + 300).map(([, gap]) => gap),
    gapsBefore: paceReport.gaps.filter(([at]) => at < startedAt).map(([, gap]) => gap),
    // For scale: how long the window the gaps of `gapsDuringAttach` come from is, and the one before it.
    windowMs: attachMs + 300,
  };
}

/** Whether `attachSuppressor` gives null when the server answers 404 for the binary. */
async function missingBinary(kind: WorkletSuppressor, path: string): Promise<boolean> {
  resetSuppressorCacheForTests();
  await fetch("/__missing", { method: "POST", body: path });
  try {
    const context = new OfflineAudioContext(1, QUANTUM, SAMPLE_RATE);
    const handle = await attachSuppressor(kind, context as unknown as AudioContext, context.createGain());
    return handle === null;
  } finally {
    await fetch("/__missing", { method: "DELETE" });
    resetSuppressorCacheForTests();
  }
}

/**
 * The engine the remote mixer cleans a strip with, through the mixer itself
 * in a real-time context: a talker sent as a MediaStream comes out of the
 * element the mixer gives as sound (the last recording, speech), with two strips cleaned at once, and when
 * the call ends every suppressor node that was built has been told to
 * "destroy". The count is of the messages and the nodes, observed from
 * outside; that the processor frees its state on the message is held by the
 * denoiser's own test.
 */
async function mixer(kind: WorkletSuppressor) {
  if (kind !== REMOTE_SUPPRESSOR) return null;
  resetSuppressorCacheForTests();
  const counts = { created: 0, destroyed: 0 };
  const NativeNode = window.AudioWorkletNode;
  const nativePost = MessagePort.prototype.postMessage;
  window.AudioWorkletNode = class extends NativeNode {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      if (name === PROCESSOR_NAME[kind]) counts.created += 1;
    }
  } as typeof AudioWorkletNode;
  MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
    if (message === "destroy") counts.destroyed += 1;
    return (nativePost as (...args: unknown[]) => void).call(this, message, ...rest);
  } as typeof MessagePort.prototype.postMessage;
  try {
    const remote = new AudioContext({ sampleRate: SAMPLE_RATE });
    // A recording when there is one: the network takes the synthetic voices for noise.
    const talker = (await talkers()).at(-1)?.samples ?? new Float32Array(0);
    const buffer = remote.createBuffer(1, talker.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(talker);
    const source = remote.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const sent = remote.createMediaStreamDestination();
    source.connect(sent);
    source.start();

    const voices = new RemoteVoiceMixer("studio");
    voices.prepare();
    const elements = ["a", "b"].map(() => new Audio());
    for (const [index, element] of elements.entries()) {
      voices.attach(`voice-${index}`, sent.stream, element, 1, { suppressed: true });
    }
    // The suppressor is added in the background once the worklet has loaded.
    for (let waited = 0; waited < 6000 && !(voices.isSuppressed("voice-0") && voices.isSuppressed("voice-1")); waited += 100) {
      await sleep(100);
    }
    const suppressed = voices.isSuppressed("voice-0") && voices.isSuppressed("voice-1");

    // What the first strip's element plays, heard by a second context.
    const listener = new AudioContext({ sampleRate: SAMPLE_RATE });
    const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    await listener.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const tap = new AudioWorkletNode(listener, "bench-tap");
    tap.connect(listener.destination);
    listener.createMediaStreamSource(elements[0]?.srcObject as MediaStream).connect(tap);
    await sleep(4000);
    const heard = await tapReport(tap);
    const flat = new Float32Array(heard.samples.length * QUANTUM);
    heard.samples.forEach((chunk, index) => flat.set(chunk, index * QUANTUM));
    const window2 = flat.subarray(Math.floor(flat.length / 2));

    // One strip leaves the call, then the rest of the call.
    voices.remove("voice-0");
    await sleep(300);
    const afterOne = { ...counts };
    voices.dispose();
    await sleep(300);
    const afterCall = { ...counts };
    await listener.close();
    source.stop();
    await remote.close();
    return {
      suppressed,
      soundDb: db(energy(window2) / Math.max(1, window2.length)),
      created: afterCall.created,
      destroyedAfterOneLeft: afterOne.destroyed,
      destroyedAfterCall: afterCall.destroyed,
    };
  } finally {
    window.AudioWorkletNode = NativeNode;
    MessagePort.prototype.postMessage = nativePost;
  }
}

window.__suppressor = { ready: true, compare, quality, destroyed, missingBinary, realtime, mixer };
