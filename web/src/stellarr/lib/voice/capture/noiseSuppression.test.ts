import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GTCRN_WASM_URL,
  GTCRN_WORKLET_URL,
  PROCESSOR_NAME,
  RNNOISE_WASM_URL,
  RNNOISE_WORKLET_URL,
  SPEEX_WASM_URL,
  SPEEX_WORKLET_URL,
  attachSuppressor,
  resetSuppressorCacheForTests,
} from "./noiseSuppression";

/** Stands in for the browser's node; records what it was constructed with. */
class FakeWorkletNode {
  static created: FakeWorkletNode[] = [];
  static failWith: Error | null = null;

  /** What the processors that are compiled on the main thread do after construction: say they are ready, fail, or say nothing. */
  static compiled: "ready" | "error" | "silent" = "ready";

  connect = vi.fn();
  disconnect = vi.fn();
  port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: { data: unknown }) => void) | null } = {
    postMessage: vi.fn(),
    onmessage: null,
  };
  onprocessorerror: (() => void) | null = null;

  constructor(
    readonly context: AudioContext,
    readonly name: string,
    readonly options: AudioWorkletNodeOptions,
  ) {
    if (FakeWorkletNode.failWith) throw FakeWorkletNode.failWith;
    FakeWorkletNode.created.push(this);
    if ((name === PROCESSOR_NAME.rnnoise || name === PROCESSOR_NAME.gtcrn) && FakeWorkletNode.compiled !== "silent") {
      const ready = FakeWorkletNode.compiled === "ready";
      queueMicrotask(() => (ready ? this.port.onmessage?.({ data: "ready" }) : this.onprocessorerror?.()));
    }
  }
}

const compiled = {} as WebAssembly.Module;
const binaries = new Map<string, ArrayBuffer>();
const fetchBinary = vi.fn(async (url: string) => {
  const body = new ArrayBuffer(8);
  binaries.set(url, body);
  return { ok: true, status: 200, arrayBuffer: async () => body };
});

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

const lastNode = () => FakeWorkletNode.created.at(-1) as FakeWorkletNode;

beforeEach(() => {
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("fetch", fetchBinary);
  // The fake binary is eight bytes of nothing; RNNoise's and GTCRN's are compiled before the node exists.
  vi.spyOn(WebAssembly, "compile").mockImplementation(async () => compiled);
});

afterEach(() => {
  resetSuppressorCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWorkletNode.created = [];
  FakeWorkletNode.failWith = null;
  FakeWorkletNode.compiled = "ready";
  binaries.clear();
  fetchBinary.mockClear();
});

describe("suppressor graph lifecycle", () => {
  it("wires the source into the node and releases exactly once", async () => {
    const { context, source } = graph();
    const handle = await attachSuppressor("rnnoise", context, source);

    expect(handle).not.toBeNull();
    expect(handle?.kind).toBe("rnnoise");
    expect(handle?.output).toBe(lastNode());
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith(RNNOISE_WORKLET_URL);
    expect(source.connect).toHaveBeenCalledWith(lastNode());
    handle?.dispose();
    handle?.dispose();

    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(lastNode().disconnect).toHaveBeenCalledOnce();
    // The processors free their WASM state on this one message.
    expect(lastNode().port.postMessage).toHaveBeenCalledOnce();
    expect(lastNode().port.postMessage).toHaveBeenCalledWith("destroy");
  });

  it("starts Speex's processor with the binary it was served, to compile itself", async () => {
    const { context, source } = graph();

    await attachSuppressor("speex", context, source);

    expect(context.audioWorklet.addModule).toHaveBeenCalledWith(SPEEX_WORKLET_URL);
    expect(fetchBinary).toHaveBeenCalledWith(SPEEX_WASM_URL);
    expect(lastNode().context).toBe(context);
    expect(lastNode().name).toBe(PROCESSOR_NAME.speex);
    expect(lastNode().options).toEqual({ processorOptions: { wasmBinary: binaries.get(SPEEX_WASM_URL) } });
    expect(lastNode().options.processorOptions.wasmBinary).toBe(binaries.get(SPEEX_WASM_URL));
  });

  it("fetches a binary once per page and registers a worklet once per context", async () => {
    const { context, source } = graph();
    const other = graph();

    await attachSuppressor("gtcrn", context, source);
    await attachSuppressor("gtcrn", context, source);
    await attachSuppressor("gtcrn", other.context, other.source);

    expect(fetchBinary).toHaveBeenCalledOnce();
    expect(context.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(other.context.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(FakeWorkletNode.created).toHaveLength(3);
  });
});

describe.each([
  ["rnnoise", RNNOISE_WORKLET_URL, RNNOISE_WASM_URL],
  ["gtcrn", GTCRN_WORKLET_URL, GTCRN_WASM_URL],
] as const)("starting %s", (kind, worklet, binary) => {
  it("hands the processor the binary compiled, and nothing else", async () => {
    const { context, source } = graph();

    const handle = await attachSuppressor(kind, context, source);

    expect(handle?.kind).toBe(kind);
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith(worklet);
    expect(fetchBinary).toHaveBeenCalledWith(binary);
    expect(WebAssembly.compile).toHaveBeenCalledWith(binaries.get(binary));
    expect(lastNode().name).toBe(PROCESSOR_NAME[kind]);
    expect(lastNode().options).toEqual({ processorOptions: { module: compiled } });
    expect(source.connect).toHaveBeenCalledWith(lastNode());
  });

  it("returns null, wiring nothing, when the binary does not compile", async () => {
    vi.spyOn(WebAssembly, "compile").mockRejectedValue(new WebAssembly.CompileError("not a module"));
    const { context, source } = graph();

    await expect(attachSuppressor(kind, context, source)).resolves.toBeNull();

    expect(FakeWorkletNode.created).toHaveLength(0);
    expect(source.connect).not.toHaveBeenCalled();
  });

  it("returns null, and frees the node, when the processor never says it is ready", async () => {
    vi.useFakeTimers();
    try {
      FakeWorkletNode.compiled = "silent";
      const { context, source } = graph();

      const attached = attachSuppressor(kind, context, source);
      await vi.advanceTimersByTimeAsync(3000);

      await expect(attached).resolves.toBeNull();
      expect(source.connect).not.toHaveBeenCalled();
      expect(lastNode().port.postMessage).toHaveBeenCalledWith("destroy");
      expect(lastNode().disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null, and frees the node, when the processor fails to start", async () => {
    FakeWorkletNode.compiled = "error";
    const { context, source } = graph();

    await expect(attachSuppressor(kind, context, source)).resolves.toBeNull();

    expect(source.connect).not.toHaveBeenCalled();
    expect(lastNode().port.postMessage).toHaveBeenCalledWith("destroy");
  });
});

describe("falling back to the browser's suppressor", () => {
  it("cleans a partially connected node when construction fails", async () => {
    const { context, source } = graph();
    (source.connect as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("cannot connect");
    });

    await expect(attachSuppressor("speex", context, source)).resolves.toBeNull();

    expect(lastNode().disconnect).toHaveBeenCalledOnce();
    expect(lastNode().port.postMessage).toHaveBeenCalledWith("destroy");
  });

  it("returns null rather than throwing when the worklet module is missing", async () => {
    const { context, source } = graph();
    (context.audioWorklet.addModule as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("404"),
    );
    await expect(attachSuppressor("gtcrn", context, source)).resolves.toBeNull();
    expect(source.connect).not.toHaveBeenCalled();
  });

  it("returns null when the binary is not served, rather than starting a silent node", async () => {
    fetchBinary.mockResolvedValueOnce({
      ok: false,
      status: 404,
      arrayBuffer: async () => new TextEncoder().encode("<!doctype html>").buffer,
    });
    const { context, source } = graph();

    await expect(attachSuppressor("gtcrn", context, source)).resolves.toBeNull();

    expect(FakeWorkletNode.created).toHaveLength(0);
    expect(source.connect).not.toHaveBeenCalled();
  });

  it("returns null when the processor cannot be constructed", async () => {
    FakeWorkletNode.failWith = new DOMException("not registered", "InvalidStateError");
    const { context, source } = graph();

    await expect(attachSuppressor("speex", context, source)).resolves.toBeNull();

    expect(source.connect).not.toHaveBeenCalled();
  });

  it("returns null where the browser has no AudioWorklet", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", fetchBinary);
    const { source } = graph();
    const context = {} as AudioContext;

    await expect(attachSuppressor("rnnoise", context, source)).resolves.toBeNull();

    expect(source.connect).not.toHaveBeenCalled();
  });
});
