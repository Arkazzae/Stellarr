import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cache keeps its memory layer in module state, so a test that wants to
// look at the stored layer alone loads a second copy of the module, as a
// reloaded page would.
async function loadCache() {
  vi.resetModules();
  return import("./translationCache");
}

function deleteCacheDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("stellarr-chat-translations");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

describe("translation cache", () => {
  beforeEach(deleteCacheDatabase);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keys a text separately for each target language", async () => {
    const { cacheKey } = await loadCache();

    expect(cacheKey("Dzień dobry", "en")).toBe(cacheKey("Dzień dobry", "en"));
    expect(cacheKey("Dzień dobry", "en")).not.toBe(cacheKey("Dzień dobry", "pl"));
    expect(cacheKey("Dzień dobry", "en")).not.toBe(cacheKey("Dobry wieczór", "en"));
  });

  it("answers from memory right after a translation is stored", async () => {
    const { cacheKey, getSync, set } = await loadCache();
    const key = cacheKey("Dzień dobry", "en");

    expect(getSync(key)).toBeUndefined();
    await set(key, "Good morning", "en");

    expect(getSync(key)).toBe("Good morning");
  });

  it("finds a translation again after a reload and keeps it in memory from then on", async () => {
    const first = await loadCache();
    const key = first.cacheKey("Dzień dobry", "en");
    await first.set(key, "Good morning", "en");

    const reloaded = await loadCache();
    expect(reloaded.getSync(key)).toBeUndefined();
    expect(await reloaded.get(key)).toBe("Good morning");
    expect(reloaded.getSync(key)).toBe("Good morning");
  });

  it("does not mix up the languages a text was stored for", async () => {
    const { cacheKey, get, set } = await loadCache();
    await set(cacheKey("Gift", "en"), "Poison", "en");
    await set(cacheKey("Gift", "pl"), "Prezent", "pl");

    expect(await get(cacheKey("Gift", "en"))).toBe("Poison");
    expect(await get(cacheKey("Gift", "pl"))).toBe("Prezent");
  });

  it("evicts the oldest entry from memory, whatever was read, and still finds it stored", async () => {
    const { get, getSync, set } = await loadCache();
    for (let index = 0; index < 1_000; index += 1) await set(`k${index}`, `v${index}`, "en");

    // A hit in memory does not move the entry, so k0 stays the oldest.
    expect(getSync("k0")).toBe("v0");
    await set("k1000", "v1000", "en");

    expect(getSync("k0")).toBeUndefined();
    expect(getSync("k1")).toBe("v1");
    expect(getSync("k1000")).toBe("v1000");
    expect(await get("k0")).toBe("v0");
  });

  it("keeps only the most recent five thousand translations stored", async () => {
    // Trimming removes the oldest writes, so each write needs its own timestamp.
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++clock);
    const { set } = await loadCache();
    // Trimming runs on every fiftieth write, so the last one below is the
    // first that finds the store over its limit.
    for (let index = 0; index < 5_050; index += 1) await set(`k${index}`, `v${index}`, "en");

    const { get } = await loadCache();
    expect(await get("k0")).toBeUndefined();
    expect(await get("k49")).toBeUndefined();
    expect(await get("k50")).toBe("v50");
    expect(await get("k5049")).toBe("v5049");
  });

  it("works without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { get, getSync, set } = await loadCache();

    await set("k", "v", "en");

    expect(getSync("k")).toBe("v");
    expect(await get("k")).toBe("v");
    expect(await get("missing")).toBeUndefined();
  });

  it("keeps working when IndexedDB refuses to open", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("blocked");
      },
    });
    const { get, set } = await loadCache();

    await expect(set("k", "v", "en")).resolves.toBeUndefined();

    expect(await get("k")).toBe("v");
    expect(await get("missing")).toBeUndefined();
  });
});
