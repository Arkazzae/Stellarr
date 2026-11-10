import { describe, expect, it, vi } from "vitest";

import { profileFor } from "./audioProfiles";
import { captureMicrophone, type CaptureDeps } from "./micPipeline";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";

function rawTrack(): MediaStreamTrack {
  return {
    kind: "audio",
    contentHint: "",
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => undefined),
    getConstraints: () => ({}),
    getSettings: () => ({}),
    getCapabilities: () => ({ echoCancellation: [true, false] }),
  } as unknown as MediaStreamTrack;
}

function stream(track: MediaStreamTrack): MediaStream {
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
}

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function context(patch: Record<string, unknown> = {}) {
  const peers = rawTrack();
  const close = vi.fn(async () => undefined);
  const fake = {
    state: "running",
    sampleRate: 48_000,
    currentTime: 0,
    close,
    createMediaStreamSource: () => node(),
    createGain: () => ({
      ...node(),
      gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
    }),
    createMediaStreamDestination: () => ({ ...node(), stream: stream(peers) }),
    ...patch,
  };
  return { fake: fake as unknown as AudioContext, close, peers };
}

function settings(patch: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    ...DEFAULT_SETTINGS,
    noiseSuppression: "off",
    inputGate: false,
    autoGainControl: false,
    echoCancellation: false,
    ...patch,
  };
}

function open(track: MediaStreamTrack, patch: Partial<VoiceSettings>, deps: CaptureDeps = {}) {
  return captureMicrophone(settings(patch), { getUserMedia: async () => stream(track), ...deps });
}

describe("a capture without a graph", () => {
  it("offers inert controls over the untouched device", async () => {
    const track = rawTrack();
    const capture = await open(track, {});

    expect(capture.processed).toBe(false);
    expect(capture.stream).toBe(capture.monitorStream);
    expect(capture.gateActive).toBe(false);
    expect(capture.autoGain).toBe("none");
    expect(() => {
      capture.setSensitivity(10);
      capture.setInputGain(5);
      capture.fadeIn();
    }).not.toThrow();
    await expect(capture.resume()).resolves.toBe(true);
    capture.dispose();
    expect(track.stop).toHaveBeenCalledOnce();
  });
});

describe("a capture with a graph", () => {
  it("gives the processed track the profile's content hint", async () => {
    const { fake, peers } = context();

    const capture = await open(
      rawTrack(),
      { inputGainDb: 6, opusProfile: "studio" },
      {
        createContext: () => fake,
      },
    );

    expect(capture.track).toBe(peers);
    expect(peers.contentHint).toBe(profileFor(settings({ opusProfile: "studio" })).contentHint);
    capture.dispose();
  });

  it("stops the device and closes the context once, however often it is disposed", async () => {
    const { fake, close } = context();
    const track = rawTrack();
    const capture = await open(track, { inputGainDb: 6 }, { createContext: () => fake });

    capture.dispose();
    capture.dispose();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to the device, with the browser suppressor restored, when the graph cannot be wired", async () => {
    const { fake, close } = context({
      createMediaStreamSource: () => {
        throw new Error("context is gone");
      },
    });
    const track = rawTrack();

    const capture = await open(
      track,
      { noiseSuppression: "rnnoise" },
      {
        createContext: () => fake,
        attach: vi.fn(),
      },
    );

    expect(capture.processed).toBe(false);
    expect(capture.track).toBe(track);
    expect(capture.noiseSuppression).toBe("browser");
    expect(track.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ noiseSuppression: true }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("reports the leveller as running when the detector carries it", async () => {
    const { fake } = context();
    const detector = { ...node(), port: { postMessage: vi.fn() } };

    const capture = await open(
      rawTrack(),
      { autoGainControl: true, inputGate: true },
      {
        createContext: () => fake,
        createGate: async () => detector as unknown as AudioWorkletNode,
      },
    );

    expect(capture.autoGain).toBe("worklet");
    expect(capture.gateActive).toBe(true);
    capture.dispose();
  });

  it("forwards live adjustments to the graph", async () => {
    const { fake } = context();
    const detector = { ...node(), port: { postMessage: vi.fn() } };
    const capture = await open(
      rawTrack(),
      { inputGate: true },
      {
        createContext: () => fake,
        createGate: async () => detector as unknown as AudioWorkletNode,
      },
    );

    capture.setSensitivity(80);

    expect(detector.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "config" }),
    );
    capture.dispose();
  });
});
