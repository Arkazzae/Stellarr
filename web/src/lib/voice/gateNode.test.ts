import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GATE_DEFAULTS,
  VAD_PROCESSOR_NAME,
  sensitivityToThresholds,
} from "../../../public/audio/vad-processor.js";
import { buildGateNode } from "./gateNode";
import { VAD_WORKLET_URL } from "./vad";

const built = vi.hoisted(() => [] as Array<{ name: string; options: Record<string, unknown> }>);

class FakeWorkletNode {
  constructor(_context: unknown, name: string, options: Record<string, unknown>) {
    built.push({ name, options });
  }
}

function context(addModule = vi.fn(async () => undefined)) {
  return {
    sampleRate: 48_000,
    audioWorklet: { addModule },
  } as unknown as AudioContext & { audioWorklet: { addModule: typeof addModule } };
}

afterEach(() => {
  built.length = 0;
  vi.unstubAllGlobals();
});

describe("buildGateNode", () => {
  it("builds the detector with the stages, timings and thresholds it was asked for", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const target = context();

    const node = await buildGateNode(target, 35, { gate: true, leveller: false });

    expect(node).toBeInstanceOf(FakeWorkletNode);
    expect(target.audioWorklet.addModule).toHaveBeenCalledWith(VAD_WORKLET_URL);
    expect(built).toHaveLength(1);
    expect(built[0]?.name).toBe(VAD_PROCESSOR_NAME);
    expect(built[0]?.options).toMatchObject({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    expect(built[0]?.options.processorOptions).toEqual({
      sampleRate: 48_000,
      gate: true,
      gateEnabled: true,
      leveller: false,
      levellerEnabled: true,
      lookaheadMs: GATE_DEFAULTS.lookaheadMs,
      attackMs: GATE_DEFAULTS.attackMs,
      releaseMs: GATE_DEFAULTS.releaseMs,
      publishSilentLevels: false,
      ...sensitivityToThresholds(35),
    });
  });

  it("builds a leveller without a gate when only automatic volume is on", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);

    await buildGateNode(context(), 60, { gate: false, leveller: true });

    expect(built[0]?.options.processorOptions).toMatchObject({ gate: false, leveller: true });
  });

  it("registers the module once per context", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const first = context();
    const second = context();

    await buildGateNode(first, 50, { gate: true, leveller: false });
    await buildGateNode(first, 50, { gate: true, leveller: true });
    await buildGateNode(second, 50, { gate: true, leveller: false });

    expect(first.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(second.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(built).toHaveLength(3);
  });

  it("resolves to null without AudioWorklet support", async () => {
    await expect(buildGateNode(context(), 50, { gate: true, leveller: false })).resolves.toBeNull();

    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const noWorklet = { sampleRate: 48_000 } as unknown as AudioContext;
    await expect(buildGateNode(noWorklet, 50, { gate: true, leveller: false })).resolves.toBeNull();
  });

  it("resolves to null when the module will not load, and tries again next time", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const addModule = vi.fn(async () => undefined);
    addModule.mockRejectedValueOnce(new Error("404"));
    const target = context(addModule);

    await expect(buildGateNode(target, 50, { gate: true, leveller: false })).resolves.toBeNull();
    await expect(
      buildGateNode(target, 50, { gate: true, leveller: false }),
    ).resolves.not.toBeNull();
    expect(addModule).toHaveBeenCalledTimes(2);
  });
});
