import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCaptureGraph, type GraphDeps } from "./captureGraph";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";

function track() {
  return { stop: vi.fn(), contentHint: "" } as unknown as MediaStreamTrack;
}

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function audioParam() {
  return {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

function detector() {
  return { ...node(), port: { postMessage: vi.fn() } };
}

/** A context whose destinations remember the tracks they handed out. */
function fakeContext(patch: Partial<Record<string, unknown>> = {}) {
  const destinations: Array<
    ReturnType<typeof node> & { stream: MediaStream; tracks: MediaStreamTrack[] }
  > = [];
  const gain = { ...node(), gain: audioParam() };
  const context = {
    state: "running",
    sampleRate: 48_000,
    currentTime: 2,
    close: vi.fn(async () => undefined),
    createMediaStreamSource: vi.fn(() => node()),
    createGain: vi.fn(() => gain),
    createMediaStreamDestination: vi.fn(() => {
      const tracks = [track()];
      const destination = {
        ...node(),
        tracks,
        stream: { getTracks: () => tracks, getAudioTracks: () => tracks } as unknown as MediaStream,
      };
      destinations.push(destination);
      return destination;
    }),
  };
  // Descriptors, not a spread, so a getter in `patch` stays live.
  Object.defineProperties(context, Object.getOwnPropertyDescriptors(patch));
  return { context, gain, destinations, asContext: () => context as unknown as AudioContext };
}

const raw = {} as MediaStream;

function settings(patch: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    ...DEFAULT_SETTINGS,
    noiseSuppression: "off",
    inputGate: false,
    autoGainControl: false,
    ...patch,
  };
}

function deps(fake: ReturnType<typeof fakeContext>, rest: GraphDeps = {}): GraphDeps {
  return { createContext: fake.asContext, ...rest };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCaptureGraph lifecycle", () => {
  it("releases every node, both derived streams and the context on dispose", async () => {
    const fake = fakeContext();
    const gate = detector();
    const suppressorDispose = vi.fn();
    const graph = await buildCaptureGraph(
      raw,
      settings({ noiseSuppression: "rnnoise", inputGate: true }),
      deps(fake, {
        attach: async () => ({
          kind: "rnnoise",
          output: node() as unknown as AudioNode,
          dispose: suppressorDispose,
        }),
        createGate: async () => gate as unknown as AudioWorkletNode,
      }),
    );

    expect(graph).not.toBeNull();
    expect(fake.destinations).toHaveLength(2);
    graph?.dispose();
    graph?.dispose();

    expect(suppressorDispose).toHaveBeenCalledOnce();
    expect(gate.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(gate.disconnect).toHaveBeenCalledOnce();
    for (const destination of fake.destinations) {
      expect(destination.disconnect).toHaveBeenCalledOnce();
      expect(destination.tracks[0]?.stop).toHaveBeenCalledOnce();
    }
    expect(fake.context.close).toHaveBeenCalledOnce();
  });

  it("closes the context and releases a built suppressor when wiring fails", async () => {
    const fake = fakeContext({
      createMediaStreamDestination: vi.fn(() => {
        throw new Error("no destination");
      }),
    });
    const suppressorDispose = vi.fn();

    const graph = await buildCaptureGraph(
      raw,
      settings({ noiseSuppression: "gtcrn" }),
      deps(fake, {
        attach: async () => ({
          kind: "gtcrn",
          output: node() as unknown as AudioNode,
          dispose: suppressorDispose,
        }),
      }),
    );

    expect(graph).toBeNull();
    expect(suppressorDispose).toHaveBeenCalledOnce();
    expect(fake.context.close).toHaveBeenCalledOnce();
  });

  it("keeps the suppressor when only the detector fails to build", async () => {
    const fake = fakeContext();
    const graph = await buildCaptureGraph(
      raw,
      settings({ noiseSuppression: "speex", inputGate: true, autoGainControl: true }),
      deps(fake, {
        attach: async () => ({
          kind: "speex",
          output: node() as unknown as AudioNode,
          dispose: vi.fn(),
        }),
        createGate: async () => {
          throw new Error("worklet blew up");
        },
      }),
    );

    expect(graph).toMatchObject({ suppressor: "speex", gateActive: false, levelling: false });
    expect(graph?.monitorStream).toBe(graph?.stream);
    graph?.dispose();
  });

  it("drops a suppressor whose attach throws and keeps the rest", async () => {
    const fake = fakeContext();
    const graph = await buildCaptureGraph(
      raw,
      settings({ noiseSuppression: "rnnoise", inputGate: true }),
      deps(fake, {
        attach: async () => {
          throw new Error("wasm");
        },
        createGate: async () => detector() as unknown as AudioWorkletNode,
      }),
    );

    expect(graph).toMatchObject({ suppressor: null, gateActive: true });
    graph?.dispose();
  });

  it("reports the leveller and the gate separately", async () => {
    const fake = fakeContext();
    const graph = await buildCaptureGraph(
      raw,
      settings({ autoGainControl: true }),
      deps(fake, { createGate: async () => detector() as unknown as AudioWorkletNode }),
    );

    expect(graph).toMatchObject({ gateActive: false, levelling: true });
    graph?.dispose();
  });
});

describe("buildCaptureGraph context choice", () => {
  it("opens the default context at 48 kHz", async () => {
    const created: unknown[] = [];
    const fake = fakeContext();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor(options: unknown) {
          created.push(options);
          return fake.context;
        }
      },
    );

    const graph = await buildCaptureGraph(raw, settings({ inputGainDb: 6 }), {});

    expect(created).toEqual([{ sampleRate: 48_000 }]);
    expect(graph).not.toBeNull();
    graph?.dispose();
  });

  it("gives up cleanly when the context reports another rate", async () => {
    const fake = fakeContext({ sampleRate: 44_100 });
    const createGate = vi.fn();

    const graph = await buildCaptureGraph(
      raw,
      settings({ inputGate: true }),
      deps(fake, { createGate }),
    );

    expect(graph).toBeNull();
    expect(createGate).not.toHaveBeenCalled();
    expect(fake.context.createGain).not.toHaveBeenCalled();
    expect(fake.context.close).toHaveBeenCalledOnce();
  });

  it("does not wake a running context", async () => {
    const resume = vi.fn(async () => undefined);
    const fake = fakeContext({ resume });

    const graph = await buildCaptureGraph(raw, settings({ inputGainDb: 3 }), deps(fake));

    expect(resume).not.toHaveBeenCalled();
    graph?.dispose();
  });

  it("resumes a suspended context on request and says whether it ran", async () => {
    let state = "running";
    const fake = fakeContext({
      get state() {
        return state;
      },
      resume: vi.fn(async () => {
        state = "running";
      }),
    });
    const graph = await buildCaptureGraph(raw, settings({ inputGainDb: 3 }), deps(fake));

    state = "suspended";
    await expect(graph?.resume()).resolves.toBe(true);

    state = "closed";
    await expect(graph?.resume()).resolves.toBe(false);
  });
});

describe("buildCaptureGraph gain control", () => {
  it("ramps up from silence to the level currently chosen", async () => {
    const fake = fakeContext();
    const graph = await buildCaptureGraph(raw, settings({ inputGainDb: 6 }), deps(fake));

    graph?.setInputGain(-6);
    graph?.fadeIn();

    const target = 10 ** (-6 / 20);
    expect(fake.gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 2);
    expect(fake.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(target, 6),
      expect.closeTo(2.12, 6),
    );
  });

  it("settles on the target when the ramp is not available", async () => {
    const fake = fakeContext();
    fake.gain.gain.linearRampToValueAtTime.mockImplementation(() => {
      throw new TypeError("not a function");
    });
    const graph = await buildCaptureGraph(raw, settings({ inputGainDb: 6 }), deps(fake));

    fake.gain.gain.value = 0;
    expect(() => graph?.fadeIn()).not.toThrow();
    expect(fake.gain.gain.value).toBeCloseTo(10 ** (6 / 20), 6);
  });

  it("ignores gain, sensitivity and fades once disposed", async () => {
    const fake = fakeContext();
    const gate = detector();
    const graph = await buildCaptureGraph(
      raw,
      settings({ inputGate: true }),
      deps(fake, { createGate: async () => gate as unknown as AudioWorkletNode }),
    );
    graph?.dispose();
    gate.port.postMessage.mockClear();

    graph?.setInputGain(10);
    graph?.setSensitivity(80);
    graph?.fadeIn();

    expect(fake.gain.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(fake.gain.gain.setValueAtTime).not.toHaveBeenCalled();
    expect(gate.port.postMessage).not.toHaveBeenCalled();
  });

  it("survives a closed detector port when retuning", async () => {
    const fake = fakeContext();
    const gate = detector();
    gate.port.postMessage.mockImplementation(() => {
      throw new Error("port closed");
    });
    const graph = await buildCaptureGraph(
      raw,
      settings({ inputGate: true }),
      deps(fake, { createGate: async () => gate as unknown as AudioWorkletNode }),
    );

    expect(() => graph?.setSensitivity(40)).not.toThrow();
    graph?.dispose();
  });
});
