import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLAYBACK_PROFILES,
  REMOTE_GATE_SENSITIVITY,
  REMOTE_SUPPRESSOR,
  RemoteVoiceMixer,
  VOICE_PLAYBACK_GAIN,
  clampParticipantVolume,
  type RemoteVoiceMixerDeps,
} from "./remoteMixer";
import { sensitivityToThresholds } from "../../../public/audio/vad-processor.js";
import { PLAYBACK_TUNING_PRESETS } from "./settings";

class FakeParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;
  static initialState: AudioContextState = "running";

  state: AudioContextState = FakeAudioContext.initialState;
  currentTime = 1;
  filters: FakeFilter[] = [];
  compressors: FakeCompressor[] = [];
  gains: FakeGain[] = [];
  outputTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  output = {
    ...new FakeNode(),
    stream: {
      id: "processed",
      getTracks: () => [this.outputTrack],
    } as unknown as MediaStream,
  };

  constructor() {
    FakeAudioContext.latest = this;
  }

  audioWorklet = { addModule: vi.fn(async () => undefined) };
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createMediaElementSource = vi.fn(() => new FakeNode());
  createBiquadFilter = vi.fn(() => {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  });
  createDynamicsCompressor = vi.fn(() => {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  });
  createGain = vi.fn(() => {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  });
  createMediaStreamDestination = vi.fn(() => this.output);
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

class FakeWorkletNode extends FakeNode {
  static created: FakeWorkletNode[] = [];
  port = { postMessage: vi.fn() };
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: { processorOptions: Record<string, unknown> },
  ) {
    super();
    FakeWorkletNode.created.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorkletNode.created = [];
  FakeAudioContext.latest = null;
  FakeAudioContext.initialState = "running";
});

describe("receiver-side voice mixer", () => {
  it("has an off profile with neutral EQ and dynamics", () => {
    expect(PLAYBACK_PROFILES.off).toMatchObject({
      highpassHz: 10,
      warmthDb: 0,
      mudDb: 0,
      presenceDb: 0,
      airDb: 0,
      compressorRatio: 1,
    });
  });

  it("keeps the natural profile restrained but no longer inaudible", () => {
    expect(PLAYBACK_PROFILES.natural).toMatchObject({
      warmthDb: 1,
      mudDb: -1.5,
      presenceDb: 1.5,
      airDb: 0.5,
      compressorRatio: 2,
    });
  });

  it("cuts rumble and mud before adding presence in the studio profile", () => {
    const profile = PLAYBACK_PROFILES.studio;
    expect(profile.highpassHz).toBeGreaterThanOrEqual(70);
    expect(profile.mudDb).toBeLessThan(0);
    expect(profile.presenceDb).toBeGreaterThan(0);
    expect(profile.compressorRatio).toBeGreaterThan(1);
  });

  it("clamps a participant strip to the 0–200 percent mixer range", () => {
    expect(clampParticipantVolume(-1)).toBe(0);
    expect(clampParticipantVolume(73.6)).toBe(74);
    expect(clampParticipantVolume(900)).toBe(200);
    expect(clampParticipantVolume(Number.NaN)).toBe(100);
  });

  it("primes a suspended receiver context during the join gesture", async () => {
    FakeAudioContext.initialState = "suspended";
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer("studio");

    mixer.prepare();

    const context = FakeAudioContext.latest!;
    expect(context.resume).toHaveBeenCalledOnce();
    await expect(mixer.resume()).resolves.toBe(true);
    expect(context.state).toBe("running");
    mixer.dispose();
  });

  it("builds a processed MediaStream strip and retunes it live", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");

    expect(
      mixer.attach("ada", { id: "raw" } as MediaStream, element, 125),
    ).toBe(true);
    expect(element.srcObject).toMatchObject({ id: "processed" });

    const context = FakeAudioContext.latest!;
    expect(context.filters[0]?.frequency.value).toBe(76);
    expect(context.filters[2]?.gain.value).toBe(-4.5);
    expect(context.compressors[0]?.ratio.value).toBeCloseTo(4.25);
    expect(context.compressors[1]?.threshold.value).toBe(-1);
    expect(context.compressors[1]?.ratio.value).toBe(20);
    expect(context.gains[0]?.gain.value).toBeCloseTo(1.567);
    expect(context.gains[1]?.gain.value).toBe(1.25 * VOICE_PLAYBACK_GAIN);

    mixer.setProfile("broadcast", PLAYBACK_TUNING_PRESETS.broadcast);
    mixer.setVolume("ada", 175);
    expect(context.filters[0]?.frequency.value).toBe(92);
    expect(context.compressors[0]?.ratio.value).toBeCloseTo(5.5);
    expect(context.gains[0]?.gain.value).toBeCloseTo(1.862);
    expect(context.gains[1]?.gain.value).toBe(1.75 * VOICE_PLAYBACK_GAIN);

    mixer.setProfile("custom", {
      warmthDb: -1,
      mudDb: -4.5,
      presenceDb: 3.5,
      airDb: 2,
      compression: 40,
    });
    expect(context.filters[1]?.gain.value).toBe(-1);
    expect(context.filters[2]?.gain.value).toBe(-4.5);
    expect(context.filters[3]?.gain.value).toBe(3.5);
    expect(context.filters[4]?.gain.value).toBe(2);
    expect(context.compressors[0]?.ratio.value).toBeCloseTo(3);
    expect(context.gains[0]?.gain.value).toBeCloseTo(1.318);
    mixer.dispose();
    expect(context.outputTrack.stop).toHaveBeenCalledOnce();
  });

  it("attenuates behind the limiter so turning someone down is audible", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");

    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 60)).toBe(
      true,
    );

    const context = FakeAudioContext.latest!;
    // Below unity nothing is added in front of the limiter; the whole cut is
    // taken after it, where it cannot be given back as "less limiting".
    expect(context.gains[1]?.gain.value).toBe(VOICE_PLAYBACK_GAIN);
    expect(context.gains[2]?.gain.value).toBeCloseTo(0.6);

    mixer.setVolume("ada", 150);
    expect(context.gains[1]?.gain.value).toBeCloseTo(1.5 * VOICE_PLAYBACK_GAIN);
    expect(context.gains[2]?.gain.value).toBe(1);
    mixer.dispose();
  });

  it("can keep shared media at unity gain while retaining the 0–200 range", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer("off", undefined, 1);
    const element = document.createElement("audio");

    expect(
      mixer.attach("screen:ada", { id: "screen" } as MediaStream, element, 125),
    ).toBe(true);
    expect(FakeAudioContext.latest?.gains[1]?.gain.value).toBe(1.25);
    mixer.dispose();
  });

  it("runs a local playback sample through the same receiver strip", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer(
      "studio",
      PLAYBACK_TUNING_PRESETS.studio,
    );
    const source = document.createElement("audio");
    const output = document.createElement("audio");

    expect(mixer.attachElement("preview", source, output, 100)).toBe(true);

    const context = FakeAudioContext.latest!;
    expect(context.createMediaElementSource).toHaveBeenCalledWith(source);
    expect(output.srcObject).toMatchObject({ id: "processed" });
    expect(context.filters[2]?.gain.value).toBe(-4.5);
    expect(context.compressors[0]?.ratio.value).toBeCloseTo(4.25);
    mixer.dispose();
  });

  it("ends the destination track when a participant strip is removed", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");

    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 100)).toBe(
      true,
    );
    const context = FakeAudioContext.latest!;

    mixer.remove("ada");

    expect(context.outputTrack.stop).toHaveBeenCalledOnce();
    mixer.dispose();
    expect(context.outputTrack.stop).toHaveBeenCalledOnce();
  });
});

describe("receiver-side gate", () => {
  it("inserts the gate before the EQ and removes it cleanly", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");
    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 100)).toBe(true);
    const context = FakeAudioContext.latest!;
    const source = context.createMediaStreamSource.mock.results[0]!.value as FakeNode;
    const highpass = context.filters[0]!;

    await expect(mixer.setGate("ada", true)).resolves.toBe(true);
    expect(mixer.isGated("ada")).toBe(true);
    const gate = FakeWorkletNode.created[0]!;
    expect(gate.name).toBe("stellarr-vad");
    expect(gate.options.processorOptions).toMatchObject({
      gate: true,
      ...sensitivityToThresholds(REMOTE_GATE_SENSITIVITY),
    });
    // Source now feeds the gate, and the gate feeds the strip's first stage.
    expect(source.disconnect).toHaveBeenCalledWith(highpass);
    expect(source.connect).toHaveBeenLastCalledWith(gate);
    expect(gate.connect).toHaveBeenCalledWith(highpass);

    // Idempotent: asking again neither rebuilds nor rewires.
    await expect(mixer.setGate("ada", true)).resolves.toBe(true);
    expect(FakeWorkletNode.created).toHaveLength(1);

    await expect(mixer.setGate("ada", false)).resolves.toBe(true);
    expect(mixer.isGated("ada")).toBe(false);
    expect(gate.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(source.connect).toHaveBeenLastCalledWith(highpass);
    mixer.dispose();
  });

  it("gates on attach when the participant was already gated", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");
    expect(
      mixer.attach("ada", { id: "raw" } as MediaStream, element, 100, { gated: true }),
    ).toBe(true);
    await vi.waitFor(() => expect(mixer.isGated("ada")).toBe(true));
    mixer.remove("ada");
    expect(FakeWorkletNode.created[0]!.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    mixer.dispose();
  });

  it("reports failure without touching the strip when AudioWorklet is missing", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", undefined);
    const mixer = new RemoteVoiceMixer("studio");
    const element = document.createElement("audio");
    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 100)).toBe(true);
    const source = FakeAudioContext.latest!.createMediaStreamSource.mock.results[0]!
      .value as FakeNode;

    await expect(mixer.setGate("ada", true)).resolves.toBe(false);
    expect(mixer.isGated("ada")).toBe(false);
    expect(source.disconnect).not.toHaveBeenCalled();
    mixer.dispose();
  });
});

describe("receiver-side suppressor", () => {
  /** A suppressor that attached: wired from the source like the real one. */
  function attacher() {
    const handles: Array<{ kind: "gtcrn"; output: FakeNode; dispose: ReturnType<typeof vi.fn> }> = [];
    const attach = vi.fn(
      async (kind: "rnnoise" | "gtcrn" | "speex", _context: AudioContext, source: AudioNode) => {
        const handle = { kind: kind as "gtcrn", output: new FakeNode(), dispose: vi.fn() };
        source.connect(handle.output as unknown as AudioNode);
        handles.push(handle);
        return handle;
      },
    );
    return { attach: attach as unknown as NonNullable<RemoteVoiceMixerDeps["attach"]>, spy: attach, handles };
  }

  it("cleans the strip in front of the gate and removes both cleanly", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const { attach, spy, handles } = attacher();
    const mixer = new RemoteVoiceMixer("studio", undefined, VOICE_PLAYBACK_GAIN, { attach });
    const element = document.createElement("audio");
    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 100)).toBe(true);
    const context = FakeAudioContext.latest!;
    const source = context.createMediaStreamSource.mock.results[0]!.value as FakeNode;
    const highpass = context.filters[0]!;

    await expect(mixer.setSuppressor("ada", true)).resolves.toBe(true);
    expect(mixer.isSuppressed("ada")).toBe(true);
    expect(spy).toHaveBeenCalledWith(REMOTE_SUPPRESSOR, context, source);
    const suppressor = handles[0]!;
    // Source now feeds the suppressor; the suppressor feeds the EQ.
    expect(source.disconnect).toHaveBeenCalledWith(highpass);
    expect(suppressor.output.connect).toHaveBeenLastCalledWith(highpass);

    // A gate added afterwards goes between the suppressor and the EQ.
    await expect(mixer.setGate("ada", true)).resolves.toBe(true);
    const gate = FakeWorkletNode.created[0]!;
    expect(suppressor.output.disconnect).toHaveBeenCalledWith(highpass);
    expect(suppressor.output.connect).toHaveBeenLastCalledWith(gate);
    expect(gate.connect).toHaveBeenCalledWith(highpass);

    // Idempotent.
    await expect(mixer.setSuppressor("ada", true)).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    // Removing the suppressor hands the source straight to the gate...
    await expect(mixer.setSuppressor("ada", false)).resolves.toBe(true);
    expect(mixer.isSuppressed("ada")).toBe(false);
    expect(suppressor.dispose).toHaveBeenCalledOnce();
    expect(source.connect).toHaveBeenLastCalledWith(gate);
    // ...and removing the gate hands it to the EQ again.
    await expect(mixer.setGate("ada", false)).resolves.toBe(true);
    expect(source.connect).toHaveBeenLastCalledWith(highpass);
    mixer.dispose();
  });

  it("attaches with both stages when the participant was already cleaned and gated", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const { attach, handles } = attacher();
    const mixer = new RemoteVoiceMixer("studio", undefined, VOICE_PLAYBACK_GAIN, { attach });
    const element = document.createElement("audio");
    expect(
      mixer.attach("ada", { id: "raw" } as MediaStream, element, 100, {
        gated: true,
        suppressed: true,
      }),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(mixer.isSuppressed("ada")).toBe(true);
      expect(mixer.isGated("ada")).toBe(true);
    });
    mixer.remove("ada");
    expect(handles[0]!.dispose).toHaveBeenCalledOnce();
    mixer.dispose();
  });

  it("refuses a context the browser did not open at 48 kHz", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const { attach, spy } = attacher();
    const mixer = new RemoteVoiceMixer("studio", undefined, VOICE_PLAYBACK_GAIN, { attach });
    const element = document.createElement("audio");
    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 100)).toBe(true);
    (FakeAudioContext.latest as unknown as { sampleRate: number }).sampleRate = 44_100;

    await expect(mixer.setSuppressor("ada", true)).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(mixer.isSuppressed("ada")).toBe(false);
    mixer.dispose();
  });

  it("reports failure and leaves the strip alone when the engine cannot load", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mixer = new RemoteVoiceMixer("studio", undefined, VOICE_PLAYBACK_GAIN, {
      attach: async () => null,
    });
    const element = document.createElement("audio");
    expect(mixer.attach("ada", { id: "raw" } as MediaStream, element, 100)).toBe(true);
    const source = FakeAudioContext.latest!.createMediaStreamSource.mock.results[0]!
      .value as FakeNode;

    await expect(mixer.setSuppressor("ada", true)).resolves.toBe(false);
    expect(mixer.isSuppressed("ada")).toBe(false);
    expect(source.disconnect).not.toHaveBeenCalled();
    mixer.dispose();
  });
});
