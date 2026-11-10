import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteVoiceMixer } from "./remoteMixer";
import type { NoiseSuppressorHandle } from "./noiseSuppression";

class Param {
  value = 0;
  /** Targets of linear ramps, in order; a ramp lands at once in this fake. */
  ramps: number[] = [];
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn();
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn((value: number) => {
    this.ramps.push(value);
    this.value = value;
  });
}

class Node {
  connect = vi.fn();
  disconnect = vi.fn();
}

class Filter extends Node {
  type = "lowpass";
  frequency = new Param();
  Q = new Param();
  gain = new Param();
}

class Compressor extends Node {
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
}

class Gain extends Node {
  gain = new Param();
}

class Context {
  static failGainAt: number | null = null;
  static addModule = vi.fn(async () => undefined);

  state: AudioContextState = "running";
  currentTime = 1;
  sampleRate = 48_000;
  gains: Gain[] = [];
  track = { stop: vi.fn() };
  destination = { ...new Node(), stream: { getTracks: () => [this.track] } };
  source = new Node();
  audioWorklet = { addModule: Context.addModule };
  createMediaStreamSource = vi.fn(() => this.source);
  createBiquadFilter = vi.fn(() => new Filter());
  createDynamicsCompressor = vi.fn(() => new Compressor());
  createGain = vi.fn(() => {
    if (Context.failGainAt === this.gains.length) throw new Error("out of nodes");
    const node = new Gain();
    this.gains.push(node);
    return node;
  });
  createMediaStreamDestination = vi.fn(() => this.destination);
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

class Worklet extends Node {
  static created: Worklet[] = [];
  port = { postMessage: vi.fn() };
  constructor() {
    super();
    Worklet.created.push(this);
  }
}

/** Every context a test's mixer opened, newest last. */
const contexts: Context[] = [];
class TrackedContext extends Context {
  constructor() {
    super();
    contexts.push(this);
  }
}

function stubWebAudio(): void {
  vi.stubGlobal("AudioContext", TrackedContext);
  vi.stubGlobal("AudioWorkletNode", Worklet);
}

function attached(mixer: RemoteVoiceMixer, volume = 100): Context {
  const ok = mixer.attach("ada", {} as MediaStream, document.createElement("audio"), volume);
  expect(ok).toBe(true);
  return contexts[contexts.length - 1]!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  contexts.length = 0;
  Worklet.created = [];
  Context.failGainAt = null;
  Context.addModule.mockClear();
});

describe("remote voice mixer without Web Audio", () => {
  it("reports that nothing was attached and has nothing to change", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");

    expect(mixer.attach("ada", {} as MediaStream, element, 100)).toBe(false);
    expect(mixer.attachElement("ada", element, element, 100)).toBe(false);
    expect(element.srcObject).toBeFalsy();
    await expect(mixer.setGate("ada", true)).resolves.toBe(false);
    await expect(mixer.setSuppressor("ada", true)).resolves.toBe(false);
    await expect(mixer.resume()).resolves.toBe(false);
  });
});

describe("a strip that cannot be built", () => {
  it("releases what it made and leaves the participant unattached", async () => {
    stubWebAudio();
    Context.failGainAt = 1;
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");

    expect(mixer.attach("ada", {} as MediaStream, element, 100)).toBe(false);

    const context = contexts[0]!;
    expect(context.track.stop).toHaveBeenCalledOnce();
    expect(context.source.disconnect).toHaveBeenCalled();
    expect(element.srcObject).toBeFalsy();
    await expect(mixer.setGate("ada", true)).resolves.toBe(false);
    mixer.dispose();
  });
});

describe("gate changes on one strip", () => {
  it("builds a single gate when it is asked for twice at once", async () => {
    stubWebAudio();
    const mixer = new RemoteVoiceMixer("studio");
    const context = attached(mixer);

    await expect(
      Promise.all([mixer.setGate("ada", true), mixer.setGate("ada", true)]),
    ).resolves.toEqual([true, true]);

    expect(Worklet.created).toHaveLength(1);
    const feedsGate = context.source.connect.mock.calls.filter(
      ([target]) => target === Worklet.created[0],
    );
    expect(feedsGate).toHaveLength(1);
    mixer.dispose();
  });

  it("ends ungated, with the worklet stopped, when asked to gate and then to ungate", async () => {
    stubWebAudio();
    const mixer = new RemoteVoiceMixer("studio");
    attached(mixer);

    const on = mixer.setGate("ada", true);
    const off = mixer.setGate("ada", false);

    await expect(Promise.all([on, off])).resolves.toEqual([true, true]);
    expect(mixer.isGated("ada")).toBe(false);
    expect(Worklet.created[0]!.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    mixer.dispose();
  });

  it("does not leave a gate behind when the participant leaves while it loads", async () => {
    stubWebAudio();
    let finishLoading!: () => void;
    Context.addModule.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishLoading = () => resolve(undefined))),
    );
    const mixer = new RemoteVoiceMixer("studio");
    const context = attached(mixer);

    const pending = mixer.setGate("ada", true);
    await vi.waitFor(() => expect(Context.addModule).toHaveBeenCalled());
    mixer.remove("ada");
    finishLoading();

    await expect(pending).resolves.toBe(false);
    expect(mixer.isGated("ada")).toBe(false);
    expect(Worklet.created[0]!.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(context.source.connect).toHaveBeenCalledTimes(1);
    mixer.dispose();
  });

  it("reports failure when the worklet module cannot be loaded", async () => {
    stubWebAudio();
    Context.addModule.mockRejectedValueOnce(new Error("404"));
    const mixer = new RemoteVoiceMixer("studio");
    const context = attached(mixer);
    context.source.disconnect.mockClear();

    await expect(mixer.setGate("ada", true)).resolves.toBe(false);
    expect(mixer.isGated("ada")).toBe(false);
    expect(context.source.disconnect).not.toHaveBeenCalled();
    mixer.dispose();
  });
});

describe("suppressor changes on one strip", () => {
  function suppressor() {
    const output = new Node();
    const dispose = vi.fn();
    const handle: NoiseSuppressorHandle = {
      kind: "gtcrn",
      output: output as unknown as AudioNode,
      dispose,
    };
    return { handle, output, dispose };
  }

  it("disposes a suppressor that finished loading after the participant left", async () => {
    stubWebAudio();
    const loaded = suppressor();
    let finishLoading!: (value: NoiseSuppressorHandle) => void;
    const mixer = new RemoteVoiceMixer("studio", undefined, 1.25, {
      attach: () => new Promise((resolve) => (finishLoading = resolve)),
    });
    attached(mixer);

    const pending = mixer.setSuppressor("ada", true);
    await vi.waitFor(() => expect(finishLoading).toBeTypeOf("function"));
    mixer.remove("ada");
    finishLoading(loaded.handle);

    await expect(pending).resolves.toBe(false);
    expect(loaded.dispose).toHaveBeenCalledOnce();
    expect(loaded.output.connect).not.toHaveBeenCalled();
    mixer.dispose();
  });
});

describe("volume during a rewire", () => {
  it("keeps the strip muted until the change is done, then lands on the new level", async () => {
    vi.useFakeTimers();
    stubWebAudio();
    const mixer = new RemoteVoiceMixer("studio");
    const context = attached(mixer);
    const trim = context.gains[2]!.gain;
    const boost = context.gains[1]!.gain;

    const pending = mixer.setGate("ada", true);
    await vi.advanceTimersByTimeAsync(5);
    expect(trim.ramps).toEqual([0]);

    mixer.setVolume("ada", 50);
    expect(trim.ramps).toEqual([0]);
    expect(boost.value).toBe(1.25);

    await vi.advanceTimersByTimeAsync(30);
    await expect(pending).resolves.toBe(true);
    expect(trim.ramps).toEqual([0, 0.5]);
    mixer.dispose();
  });
});
