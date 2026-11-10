import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BAR_COUNT, MAX_PEAK_BYTES, peaksFrom, useAudioPeaks } from "./peaks";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("peaksFrom", () => {
  it("reduces the samples to the requested number of bars", () => {
    expect(peaksFrom(new Float32Array(BAR_COUNT * 40).fill(0.3))).toHaveLength(BAR_COUNT);
    expect(peaksFrom(new Float32Array(100).fill(0.3), 10)).toHaveLength(10);
  });

  it("scales the loudest bar to 1 so a quiet recording still fills the row", () => {
    const channel = new Float32Array(40);
    channel.fill(0.04, 0, 20);
    channel.fill(0.01, 20);

    const [loud, quiet] = peaksFrom(channel, 2);
    expect(loud).toBeCloseTo(1);
    expect(quiet).toBeCloseTo(0.25);
  });

  it("measures the loudness of a slice rather than its single highest sample", () => {
    const channel = new Float32Array(200).fill(0.1);
    channel[5] = 1;

    const [spiked, steady] = peaksFrom(channel, 2);
    expect(spiked).toBeCloseTo(1);
    // A peak detector would leave the steady bar at a tenth of the spiked one.
    expect(steady).toBeCloseTo(0.709, 2);
  });

  it("treats a negative swing like a positive one", () => {
    const [up, down] = peaksFrom(Float32Array.from([0.5, 0.5, -0.5, -0.5]), 2);
    expect(down).toBeCloseTo(up ?? 0);
  });

  it("leaves silence at zero instead of dividing by it", () => {
    expect(peaksFrom(new Float32Array(300), 3)).toEqual([0, 0, 0]);
  });

  it("draws an empty row when there are fewer samples than bars", () => {
    expect(peaksFrom(new Float32Array(3), 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("useAudioPeaks", () => {
  function stubAudio(samples: Float32Array) {
    const decodeAudioData = vi.fn(async () => ({ getChannelData: () => samples }));
    class FakeAudioContext {
      decodeAudioData = decodeAudioData;
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    return decodeAudioData;
  }

  function stubFetch(bytes: number, ok = true) {
    const fetchMock = vi.fn(async () => ({
      ok,
      arrayBuffer: async () => new ArrayBuffer(bytes),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("measures a file once and shares the answer between rows", async () => {
    const decode = stubAudio(new Float32Array(20).fill(0.5));
    const fetchMock = stubFetch(64);

    const first = renderHook(() => useAudioPeaks("/assets/shared", true, 4));
    const second = renderHook(() => useAudioPeaks("/assets/shared", true, 4));

    expect(first.result.current).toBeNull();
    await waitFor(() => expect(first.result.current).toEqual([1, 1, 1, 1]));
    expect(second.result.current).toEqual([1, 1, 1, 1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("keeps different resolutions of one file apart", async () => {
    stubAudio(new Float32Array(24).fill(0.5));
    stubFetch(64);

    const coarse = renderHook(() => useAudioPeaks("/assets/resolution", true, 2));
    const fine = renderHook(() => useAudioPeaks("/assets/resolution", true, 6));

    await waitFor(() => expect(coarse.result.current).toHaveLength(2));
    await waitFor(() => expect(fine.result.current).toHaveLength(6));
  });

  it("requests nothing until it is enabled", async () => {
    stubAudio(new Float32Array(20).fill(0.5));
    const fetchMock = stubFetch(64);

    const { result, rerender } = renderHook(
      ({ enabled }) => useAudioPeaks("/assets/deferred", enabled, 4),
      { initialProps: { enabled: false } },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toHaveLength(4));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays on the placeholder when the file cannot be fetched, without asking again", async () => {
    stubAudio(new Float32Array(20));
    const fetchMock = stubFetch(0, false);

    const { result, rerender } = renderHook(() => useAudioPeaks("/assets/missing", true, 4));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender();

    expect(result.current).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not decode a file larger than the limit", async () => {
    const decode = stubAudio(new Float32Array(20));
    const fetchMock = stubFetch(MAX_PEAK_BYTES + 1);

    const { result } = renderHook(() => useAudioPeaks("/assets/huge", true, 4));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(decode).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
