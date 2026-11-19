import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachSuppressor,
  preloadSuppressor,
  resetSuppressorCacheForTests,
  SPEEX_WASM_URL,
  watchSuppressorDownloads,
  type SuppressorDownloadEvent,
} from "./noiseSuppression";

const served = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
const fetchBinary = vi.fn(async (_url: string) => served());
let created = 0;

class FakeWorkletNode {
  connect = vi.fn();
  disconnect = vi.fn();
  port = { postMessage: vi.fn() };
  constructor() {
    created += 1;
  }
}

function graph() {
  const context = {
    audioWorklet: { addModule: vi.fn(async () => undefined) },
  } as unknown as AudioContext;
  const source = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
  return { context, source };
}

beforeEach(() => {
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("fetch", fetchBinary);
});

afterEach(() => {
  resetSuppressorCacheForTests();
  vi.unstubAllGlobals();
  fetchBinary.mockReset();
  fetchBinary.mockImplementation(async () => served());
  created = 0;
});

describe("suppressor loading", () => {
  it("shares one download and one registration between simultaneous captures", async () => {
    const { context, source } = graph();

    const handles = await Promise.all([
      attachSuppressor("speex", context, source),
      attachSuppressor("speex", context, source),
    ]);

    expect(handles.every((handle) => handle !== null)).toBe(true);
    expect(fetchBinary).toHaveBeenCalledOnce();
    expect(context.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(created).toBe(2);
  });

  it("retries a failed binary download on the next attach", async () => {
    const { context, source } = graph();
    fetchBinary.mockRejectedValueOnce(new Error("offline"));

    await expect(attachSuppressor("speex", context, source)).resolves.toBeNull();
    expect(source.connect).not.toHaveBeenCalled();

    const handle = await attachSuppressor("speex", context, source);
    expect(handle?.kind).toBe("speex");
    expect(fetchBinary).toHaveBeenCalledTimes(2);
  });

  it("retries a binary the server refused on the next attach", async () => {
    const { context, source } = graph();
    fetchBinary.mockResolvedValueOnce({ ...served(), ok: false, status: 503 });

    await expect(attachSuppressor("speex", context, source)).resolves.toBeNull();
    await expect(attachSuppressor("speex", context, source)).resolves.not.toBeNull();
    expect(fetchBinary).toHaveBeenCalledTimes(2);
  });

  it("registers the worklet again after a failed registration", async () => {
    const { context, source } = graph();
    (context.audioWorklet.addModule as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("404"),
    );

    await expect(attachSuppressor("speex", context, source)).resolves.toBeNull();
    await expect(attachSuppressor("speex", context, source)).resolves.not.toBeNull();
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(2);
  });
});

describe("suppressor downloads", () => {
  /** A response whose body arrives in the given chunks, as a network stream does. */
  function streamed(...sizes: number[]) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of sizes) controller.enqueue(new Uint8Array(size).fill(7));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  function watch() {
    const events: SuppressorDownloadEvent[] = [];
    watchSuppressorDownloads((event) => events.push(event));
    return events;
  }

  it("reports the bytes of a streamed binary as they arrive and keeps the whole file", async () => {
    const events = watch();
    fetchBinary.mockResolvedValueOnce(streamed(1000, 2500, 500) as never);

    await expect(preloadSuppressor("speex")).resolves.toBe(true);

    expect(events.map(({ phase, received }) => [phase, received])).toEqual([
      ["loading", 0],
      ["loading", 1000],
      ["loading", 3500],
      ["loading", 4000],
      ["done", 4000],
    ]);
    expect(events.every((event) => event.kind === "speex" && event.url === SPEEX_WASM_URL)).toBe(
      true,
    );

    // The capture that follows finds the file here and fetches nothing.
    const { context, source } = graph();
    await expect(attachSuppressor("speex", context, source)).resolves.not.toBeNull();
    expect(fetchBinary).toHaveBeenCalledOnce();
  });

  it("ends a failed download with one final report, and downloads again when asked", async () => {
    const events = watch();
    fetchBinary.mockRejectedValueOnce(new Error("offline"));

    await expect(preloadSuppressor("gtcrn")).resolves.toBe(false);
    expect(events.map(({ phase }) => phase)).toEqual(["loading", "failed"]);

    await expect(preloadSuppressor("gtcrn")).resolves.toBe(true);
    expect(fetchBinary).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.phase).toBe("done");
  });
});
