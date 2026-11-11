import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function respond(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

/** The answer to the configuration request lives in the module, so each test loads it afresh. */
async function loadHook() {
  vi.resetModules();
  return (await import("./useGifsEnabled")).useGifsEnabled;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGifsEnabled", () => {
  it("offers GIFs once the server says they are on", async () => {
    const useGifsEnabled = await loadHook();
    fetchMock.mockResolvedValue(respond({ enabled: true, apiKey: "key" }));

    const { result } = renderHook(() => useGifsEnabled(""));

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("offers none when the server says they are off, even with a bundled key", async () => {
    const useGifsEnabled = await loadHook();
    fetchMock.mockResolvedValue(respond({ enabled: false, apiKey: "" }));

    const { result } = renderHook(() => useGifsEnabled("bundled"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(result.current).toBe(false);
  });

  it("falls back to a bundled key while the server cannot be asked", async () => {
    const useGifsEnabled = await loadHook();
    fetchMock.mockResolvedValue(respond({}, { ok: false, status: 503 }));

    const { result } = renderHook(() => useGifsEnabled("bundled"));

    await waitFor(() => expect(result.current).toBe(true));
  });
});
