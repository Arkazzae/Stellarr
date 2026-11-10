import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeWaveform } from "./WaveformTrimmer";

const BARS = 96;
const SAMPLES_PER_BAR = 10;

interface FakeBuffer {
  duration: number;
  length: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
}

function stubAudioContext(buffer: FakeBuffer) {
  const decodeAudioData = vi.fn().mockResolvedValue(buffer);
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function AudioContextMock(this: object) {
      Object.assign(this, { decodeAudioData, close });
    }),
  );
  return { decodeAudioData, close };
}

afterEach(() => vi.unstubAllGlobals());

describe("decodeWaveform", () => {
  it("reduces a clip to ninety-six peaks scaled to its loudest", async () => {
    const samples = new Float32Array(BARS * SAMPLES_PER_BAR).fill(0.25);
    samples[3] = -0.5;
    samples.fill(0, 2 * SAMPLES_PER_BAR, 3 * SAMPLES_PER_BAR);
    stubAudioContext({
      duration: 2.4,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    });

    const waveform = await decodeWaveform(new ArrayBuffer(8));

    expect(waveform.duration).toBe(2.4);
    expect(waveform.peaks).toHaveLength(BARS);
    expect(waveform.peaks[0]).toBe(1);
    expect(waveform.peaks[1]).toBe(0.5);
    // A silent stretch is still drawn.
    expect(waveform.peaks[2]).toBe(0.04);
  });

  it("takes the loudest channel of each bar", async () => {
    const quiet = new Float32Array(BARS * SAMPLES_PER_BAR).fill(0.1);
    const loud = new Float32Array(BARS * SAMPLES_PER_BAR).fill(0.1);
    loud.fill(0.8, 0, SAMPLES_PER_BAR);
    stubAudioContext({
      duration: 1,
      length: quiet.length,
      numberOfChannels: 2,
      getChannelData: (channel) => (channel === 0 ? quiet : loud),
    });

    const { peaks } = await decodeWaveform(new ArrayBuffer(8));

    expect(peaks[0]).toBe(1);
    expect(peaks[1]).toBeCloseTo(0.125);
  });

  it("decodes a copy, so the caller can still upload the bytes it passed in", async () => {
    const samples = new Float32Array(BARS).fill(0.5);
    const { decodeAudioData } = stubAudioContext({
      duration: 1,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    });
    const bytes = new ArrayBuffer(8);

    await decodeWaveform(bytes);

    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(decodeAudioData.mock.calls[0]![0]).not.toBe(bytes);
  });

  it("rejects audio that decodes to nothing, and still closes the context", async () => {
    const { close } = stubAudioContext({
      duration: 0,
      length: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(0),
    });

    await expect(decodeWaveform(new ArrayBuffer(8))).rejects.toThrow("empty");
    expect(close).toHaveBeenCalledOnce();
  });
});
