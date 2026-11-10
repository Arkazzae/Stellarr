import { afterEach, describe, expect, it, vi } from "vitest";

import { attachSuppressor, resetSuppressorCacheForTests } from "./noiseSuppression";

const wrapper = vi.hoisted(() => ({
  loadGtcrn: vi.fn(async () => new ArrayBuffer(8)),
  created: 0,
}));

vi.mock("@sapphi-red/web-noise-suppressor", () => ({
  loadRnnoise: vi.fn(),
  loadSpeex: vi.fn(),
  loadGtcrn: wrapper.loadGtcrn,
  RnnoiseWorkletNode: class {},
  SpeexWorkletNode: class {},
  GtcrnWorkletNode: class {
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
    constructor() {
      wrapper.created += 1;
    }
  },
}));

function graph() {
  const context = {
    audioWorklet: { addModule: vi.fn(async () => undefined) },
  } as unknown as AudioContext;
  const source = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
  return { context, source };
}

afterEach(() => {
  resetSuppressorCacheForTests();
  wrapper.loadGtcrn.mockReset();
  wrapper.loadGtcrn.mockImplementation(async () => new ArrayBuffer(8));
  wrapper.created = 0;
});

describe("suppressor loading", () => {
  it("shares one download and one registration between simultaneous captures", async () => {
    const { context, source } = graph();

    const handles = await Promise.all([
      attachSuppressor("gtcrn", context, source),
      attachSuppressor("gtcrn", context, source),
    ]);

    expect(handles.every((handle) => handle !== null)).toBe(true);
    expect(wrapper.loadGtcrn).toHaveBeenCalledOnce();
    expect(context.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(wrapper.created).toBe(2);
  });

  it("retries a failed binary download on the next attach", async () => {
    const { context, source } = graph();
    wrapper.loadGtcrn.mockRejectedValueOnce(new Error("offline"));

    await expect(attachSuppressor("gtcrn", context, source)).resolves.toBeNull();
    expect(source.connect).not.toHaveBeenCalled();

    const handle = await attachSuppressor("gtcrn", context, source);
    expect(handle?.kind).toBe("gtcrn");
    expect(wrapper.loadGtcrn).toHaveBeenCalledTimes(2);
  });

  it("registers the worklet again after a failed registration", async () => {
    const { context, source } = graph();
    (context.audioWorklet.addModule as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("404"),
    );

    await expect(attachSuppressor("gtcrn", context, source)).resolves.toBeNull();
    await expect(attachSuppressor("gtcrn", context, source)).resolves.not.toBeNull();
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(2);
  });
});
