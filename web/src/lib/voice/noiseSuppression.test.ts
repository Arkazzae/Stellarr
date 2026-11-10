import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GTCRN_WORKLET_URL,
  RNNOISE_WORKLET_URL,
  SPEEX_WORKLET_URL,
  attachSuppressor,
  resetSuppressorCacheForTests,
} from "./noiseSuppression";

const wrapper = vi.hoisted(() => {
  const node = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    node,
    constructed: [] as string[],
    loadRnnoise: vi.fn(async () => new ArrayBuffer(8)),
    loadGtcrn: vi.fn(async () => new ArrayBuffer(8)),
    loadSpeex: vi.fn(async () => new ArrayBuffer(8)),
  };
});

vi.mock("@sapphi-red/web-noise-suppressor", () => ({
  loadRnnoise: wrapper.loadRnnoise,
  loadGtcrn: wrapper.loadGtcrn,
  loadSpeex: wrapper.loadSpeex,
  RnnoiseWorkletNode: class RnnoiseWorkletNode {
    constructor() {
      wrapper.constructed.push("rnnoise");
      return wrapper.node;
    }
  },
  GtcrnWorkletNode: class GtcrnWorkletNode {
    constructor() {
      wrapper.constructed.push("gtcrn");
      return wrapper.node;
    }
  },
  SpeexWorkletNode: class SpeexWorkletNode {
    constructor() {
      wrapper.constructed.push("speex");
      return wrapper.node;
    }
  },
}));

function graph() {
  const context = {
    audioWorklet: { addModule: vi.fn(async () => undefined) },
  } as unknown as AudioContext;
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as MediaStreamAudioSourceNode;
  return { context, source };
}

afterEach(() => {
  resetSuppressorCacheForTests();
  wrapper.constructed.length = 0;
  wrapper.loadRnnoise.mockClear();
  wrapper.loadGtcrn.mockClear();
  wrapper.loadSpeex.mockClear();
  wrapper.node.connect.mockReset();
  wrapper.node.disconnect.mockReset();
  wrapper.node.destroy.mockReset();
});

describe("suppressor graph lifecycle", () => {
  it("wires the source into the node and releases exactly once", async () => {
    const { context, source } = graph();
    const handle = await attachSuppressor("rnnoise", context, source);

    expect(handle).not.toBeNull();
    expect(handle?.kind).toBe("rnnoise");
    expect(handle?.output).toBe(wrapper.node);
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith(RNNOISE_WORKLET_URL);
    expect(source.connect).toHaveBeenCalledWith(wrapper.node);
    handle?.dispose();
    handle?.dispose();

    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(wrapper.node.destroy).toHaveBeenCalledOnce();
  });

  it("loads each engine from its own worklet and binary", async () => {
    const { context, source } = graph();

    await attachSuppressor("gtcrn", context, source);
    expect(context.audioWorklet.addModule).toHaveBeenLastCalledWith(GTCRN_WORKLET_URL);
    expect(wrapper.loadGtcrn).toHaveBeenCalledOnce();

    await attachSuppressor("speex", context, source);
    expect(context.audioWorklet.addModule).toHaveBeenLastCalledWith(SPEEX_WORKLET_URL);
    expect(wrapper.loadSpeex).toHaveBeenCalledOnce();

    expect(wrapper.loadRnnoise).not.toHaveBeenCalled();
    expect(wrapper.constructed).toEqual(["gtcrn", "speex"]);
  });

  it("fetches a binary once per page and registers a worklet once per context", async () => {
    const { context, source } = graph();
    const other = graph();

    await attachSuppressor("gtcrn", context, source);
    await attachSuppressor("gtcrn", context, source);
    await attachSuppressor("gtcrn", other.context, other.source);

    expect(wrapper.loadGtcrn).toHaveBeenCalledOnce();
    expect(context.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(other.context.audioWorklet.addModule).toHaveBeenCalledOnce();
  });

  it("cleans a partially connected node when construction fails", async () => {
    const { context, source } = graph();
    (source.connect as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("cannot connect");
    });

    await expect(attachSuppressor("speex", context, source)).resolves.toBeNull();

    expect(wrapper.node.disconnect).toHaveBeenCalledOnce();
    expect(wrapper.node.destroy).toHaveBeenCalledOnce();
  });

  it("returns null rather than throwing when the worklet module is missing", async () => {
    const { context, source } = graph();
    (context.audioWorklet.addModule as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("404"),
    );
    await expect(attachSuppressor("gtcrn", context, source)).resolves.toBeNull();
    expect(source.connect).not.toHaveBeenCalled();
  });
});
