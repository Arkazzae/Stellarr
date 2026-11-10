import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdaptiveVad,
  sensitivityToThresholds,
} from "../../../public/audio/vad-processor.js";
import { SpeechDetector, VAD_WORKLET_URL, type SpeechReading } from "./vad";

const SAMPLE_RATE = 48000;
const FRAME = SAMPLE_RATE / 100;

class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect(target: unknown) {
    this.connections.push(target);
    return target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeWorkletNode extends FakeNode {
  static instances: FakeWorkletNode[] = [];
  static failToConstruct = false;
  port = {
    onmessage: null as ((event: { data: SpeechReading }) => void) | null,
    postMessage: vi.fn(),
  };
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: { processorOptions: Record<string, unknown> },
  ) {
    super();
    if (FakeWorkletNode.failToConstruct) throw new Error("no processor");
    FakeWorkletNode.instances.push(this);
  }
  emit(reading: SpeechReading) {
    this.port.onmessage?.({ data: reading });
  }
}

class FakeAnalyser extends FakeNode {
  static instances: FakeAnalyser[] = [];
  fftSize = 0;
  smoothingTimeConstant = 1;
  next: Float32Array = new Float32Array(FRAME);
  constructor() {
    super();
    FakeAnalyser.instances.push(this);
  }
  getFloatTimeDomainData(target: Float32Array) {
    target.set(this.next.subarray(0, target.length));
  }
}

class FakeContext {
  static instances: FakeContext[] = [];
  static rejectSampleRate = false;
  static modulePromise: Promise<void> = Promise.resolve();
  static moduleError: Error | null = null;
  state: AudioContextState = "running";
  sampleRate = SAMPLE_RATE;
  destination = new FakeNode();
  gains: (FakeNode & { gain: { value: number } })[] = [];
  addModule = vi.fn(async (_url: string) => {
    await FakeContext.modulePromise;
    if (FakeContext.moduleError) throw FakeContext.moduleError;
  });
  audioWorklet = { addModule: this.addModule };
  sources: FakeNode[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor(readonly options?: { sampleRate?: number }) {
    if (options?.sampleRate && FakeContext.rejectSampleRate) {
      throw new Error("unsupported rate");
    }
    FakeContext.instances.push(this);
  }
  createMediaStreamSource() {
    const node = new FakeNode();
    this.sources.push(node);
    return node;
  }
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: { value: 1 } });
    this.gains.push(node);
    return node;
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
}

function stream(audioTracks = 1): MediaStream {
  return {
    getAudioTracks: () => new Array(audioTracks).fill({}),
  } as unknown as MediaStream;
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

function runAnimationFrame() {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, callback] of pending) callback(0);
}

function tone(amplitude: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) {
    out[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * amplitude;
  }
  return out;
}

let readings: [string, SpeechReading][];
let detector: SpeechDetector;

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.rejectSampleRate = false;
  FakeContext.modulePromise = Promise.resolve();
  FakeContext.moduleError = null;
  FakeWorkletNode.instances = [];
  FakeWorkletNode.failToConstruct = false;
  FakeAnalyser.instances = [];
  frames.clear();
  nextFrame = 1;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    frames.delete(handle);
  });
  readings = [];
  detector = new SpeechDetector((id, reading) => readings.push([id, reading]), {
    sensitivity: 70,
  });
});

afterEach(() => {
  detector.dispose();
  vi.unstubAllGlobals();
});

function context(): FakeContext {
  const [first] = FakeContext.instances;
  if (!first) throw new Error("no audio context was created");
  return first;
}

function worklet(index = 0): FakeWorkletNode {
  const node = FakeWorkletNode.instances[index];
  if (!node) throw new Error("no worklet node was created");
  return node;
}

describe("SpeechDetector worklet path", () => {
  it("loads the carried module and wires the node through a muted sink", async () => {
    expect(await detector.add("peer", stream())).toBe(true);

    expect(context().addModule).toHaveBeenCalledWith(VAD_WORKLET_URL);
    const node = worklet();
    expect(node.name).toBe("stellarr-vad");
    expect(context().sources[0]?.connections).toEqual([node]);
    const [sink] = context().gains;
    expect(sink?.gain.value).toBe(0);
    expect(node.connections).toEqual([sink]);
    expect(sink?.connections).toEqual([context().destination]);
  });

  it("asks for a 48 kHz context and accepts the device rate when refused", async () => {
    await detector.add("a", stream());
    expect(context().options).toEqual({ sampleRate: 48000 });

    detector.dispose();
    FakeContext.instances = [];
    FakeContext.rejectSampleRate = true;
    const refused = new SpeechDetector(() => undefined);
    expect(await refused.add("a", stream())).toBe(true);
    expect(context().options).toBeUndefined();
    refused.dispose();
  });

  it("gives only the local microphone the sensitivity dial and silent levels", async () => {
    await detector.add("self", stream(), true);
    await detector.add("peer", stream());

    const [self, peer] = FakeWorkletNode.instances;
    expect(self?.options.processorOptions).toMatchObject({
      sampleRate: SAMPLE_RATE,
      publishSilentLevels: true,
      ...sensitivityToThresholds(70),
    });
    expect(peer?.options.processorOptions).toEqual({
      sampleRate: SAMPLE_RATE,
      publishSilentLevels: false,
    });
  });

  it("quantises levels and reports only changes", async () => {
    await detector.add("self", stream(), true);
    const node = worklet();

    node.emit({ speaking: false, level: 0.33 });
    node.emit({ speaking: false, level: 0.36 });
    node.emit({ speaking: true, level: 0.8 });
    node.emit({ speaking: true, level: 0.81 });

    expect(readings).toEqual([
      ["self", { speaking: false, level: 0.375 }],
      ["self", { speaking: true, level: 0.75 }],
    ]);
  });

  it("hides the level of a remote participant who is not speaking", async () => {
    await detector.add("peer", stream());
    const node = worklet();

    node.emit({ speaking: false, level: 0.5 });
    expect(readings).toEqual([]);

    node.emit({ speaking: true, level: 0.5 });
    node.emit({ speaking: false, level: 0.5 });
    expect(readings).toEqual([
      ["peer", { speaking: true, level: 0.5 }],
      ["peer", { speaking: false, level: 0 }],
    ]);
  });

  it("retunes only local sources, in place, and ignores a repeated value", async () => {
    await detector.add("self", stream(), true);
    await detector.add("peer", stream());
    const [self, peer] = FakeWorkletNode.instances;

    detector.setSensitivity(70);
    expect(self?.port.postMessage).not.toHaveBeenCalled();

    detector.setSensitivity(20);
    expect(self?.port.postMessage).toHaveBeenCalledWith({
      type: "config",
      config: sensitivityToThresholds(20),
    });
    expect(peer?.port.postMessage).not.toHaveBeenCalled();

    detector.setSensitivity(500);
    expect(self?.port.postMessage).toHaveBeenLastCalledWith({
      type: "config",
      config: sensitivityToThresholds(100),
    });
    expect(FakeWorkletNode.instances).toHaveLength(2);
  });

  it("uses the current dial for a source added later", async () => {
    detector.setSensitivity(10);
    await detector.add("self", stream(), true);
    expect(worklet().options.processorOptions).toMatchObject(
      sensitivityToThresholds(10),
    );
  });

  it("stops, detaches and silences a removed source", async () => {
    await detector.add("peer", stream());
    const node = worklet();

    detector.remove("peer");
    expect(node.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(node.disconnected).toBe(true);
    expect(context().sources[0]?.disconnected).toBe(true);

    node.emit({ speaking: true, level: 1 });
    expect(readings).toEqual([]);
    detector.remove("peer");
  });

  it("replaces the stream when an id is added again", async () => {
    await detector.add("peer", stream());
    await detector.add("peer", stream());

    expect(worklet(0).disconnected).toBe(true);
    expect(FakeWorkletNode.instances).toHaveLength(2);
    expect(context().addModule).toHaveBeenCalledTimes(1);

    worklet(1).emit({ speaking: true, level: 0.5 });
    expect(readings).toHaveLength(1);
  });

  it("attaches nothing when the source is removed during module load", async () => {
    let finishLoading: () => void = () => undefined;
    FakeContext.modulePromise = new Promise((resolve) => {
      finishLoading = resolve;
    });

    const pending = detector.add("peer", stream());
    detector.remove("peer");
    finishLoading();

    expect(await pending).toBe(false);
    expect(FakeWorkletNode.instances).toHaveLength(0);
    expect(FakeAnalyser.instances).toHaveLength(0);
    expect(context().sources[0]?.disconnected).toBe(true);
  });

  it("refuses streams without audio and streams the browser rejects", async () => {
    expect(await detector.add("mute", stream(0))).toBe(false);
    expect(FakeContext.instances).toHaveLength(0);

    await detector.add("first", stream());
    context().createMediaStreamSource = () => {
      throw new Error("track not live");
    };
    expect(await detector.add("second", stream())).toBe(false);
  });
});

describe("SpeechDetector analyser fallback", () => {
  it("analyses on the main thread when the worklet module cannot load", async () => {
    FakeContext.moduleError = new Error("blocked");

    expect(await detector.add("self", stream(), true)).toBe(true);

    expect(FakeWorkletNode.instances).toHaveLength(0);
    const [analyser] = FakeAnalyser.instances;
    expect(context().sources[0]?.connections).toEqual([analyser]);
    expect(analyser?.fftSize).toBe(2048);
    expect(analyser?.smoothingTimeConstant).toBe(0);
  });

  it("falls back when the processor cannot be constructed", async () => {
    FakeWorkletNode.failToConstruct = true;
    expect(await detector.add("self", stream())).toBe(true);
    expect(FakeAnalyser.instances).toHaveLength(1);
  });

  it("falls back, with the node released, when wiring the worklet fails", async () => {
    await detector.add("first", stream());
    const input = context().createMediaStreamSource();
    input.connect = () => {
      throw new Error("cannot connect");
    };
    context().createMediaStreamSource = () => input;

    expect(await detector.add("second", stream())).toBe(true);

    expect(worklet(1).disconnected).toBe(true);
    expect(worklet(1).port.postMessage).toHaveBeenCalledWith({ type: "stop" });
  });

  it("reports speech once a voiced signal rises above the learned floor", async () => {
    FakeContext.moduleError = new Error("blocked");
    await detector.add("self", stream(), true);
    const [analyser] = FakeAnalyser.instances;
    if (!analyser) throw new Error("no analyser");

    for (let i = 0; i < 60; i += 1) runAnimationFrame();
    analyser.next = tone(0.3);
    for (let i = 0; i < 30; i += 1) runAnimationFrame();

    expect(readings.at(-1)?.[1].speaking).toBe(true);
    expect(readings.at(-1)?.[0]).toBe("self");

    analyser.next = new Float32Array(FRAME);
    for (let i = 0; i < 120; i += 1) runAnimationFrame();
    expect(readings.at(-1)?.[1].speaking).toBe(false);
  });

  it("retunes the running main-thread detector without rebuilding it", async () => {
    FakeContext.moduleError = new Error("blocked");
    const configure = vi.spyOn(AdaptiveVad.prototype, "configure");
    await detector.add("self", stream(), true);
    await detector.add("peer", stream());

    detector.setSensitivity(5);

    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith(sensitivityToThresholds(5));
    expect(FakeAnalyser.instances).toHaveLength(2);
    configure.mockRestore();
  });

  it("stops the animation loop with the last analysed source", async () => {
    FakeContext.moduleError = new Error("blocked");
    await detector.add("a", stream());
    await detector.add("b", stream());
    expect(frames.size).toBe(1);

    detector.remove("a");
    expect(frames.size).toBe(1);
    detector.remove("b");
    expect(frames.size).toBe(0);
  });
});

describe("SpeechDetector lifecycle", () => {
  it("resumes a suspended context and reports whether it is running", async () => {
    expect(await detector.resume()).toBe(false);

    await detector.add("peer", stream());
    context().state = "suspended";
    expect(await detector.resume()).toBe(true);
    expect(context().resume).toHaveBeenCalled();

    context().state = "suspended";
    context().resume.mockRejectedValueOnce(new Error("autoplay policy"));
    expect(await detector.resume()).toBe(false);
  });

  it("primes a suspended context from prepare()", () => {
    class SuspendedContext extends FakeContext {
      override state: AudioContextState = "suspended";
    }
    vi.stubGlobal("AudioContext", SuspendedContext);

    detector.prepare();

    expect(FakeContext.instances).toHaveLength(1);
    expect(context().state).toBe("running");
    expect(context().resume).toHaveBeenCalled();
  });

  it("releases everything on dispose and refuses further work", async () => {
    await detector.add("self", stream(), true);
    await detector.add("peer", stream());
    const created = context();

    detector.dispose();

    expect(FakeWorkletNode.instances.every((node) => node.disconnected)).toBe(true);
    expect(created.gains[0]?.disconnected).toBe(true);
    expect(created.close).toHaveBeenCalledOnce();

    expect(await detector.add("late", stream())).toBe(false);
    detector.prepare();
    expect(await detector.resume()).toBe(false);
    expect(FakeContext.instances).toHaveLength(1);
    detector.dispose();
    expect(created.close).toHaveBeenCalledOnce();
  });

  it("does nothing when the browser has no Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(await detector.add("peer", stream())).toBe(false);
    detector.prepare();
    expect(await detector.resume()).toBe(false);
  });
});
