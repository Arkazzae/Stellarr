import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  VoiceSettingsStore,
} from "@/lib/voice/settings";

import { createVoiceSettingsAdapter } from "./voiceSettings";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  } as unknown as Storage;
}

function build() {
  const storage = memoryStorage();
  const store = new VoiceSettingsStore(storage);
  return { storage, store, adapter: createVoiceSettingsAdapter(store) };
}

describe("voice settings adapter", () => {
  it("reads the store's current settings", () => {
    const { adapter, store } = build();

    expect(adapter.getSnapshot()).toEqual(DEFAULT_SETTINGS);

    store.update({ outputVolume: 40 });
    expect(adapter.getSnapshot().outputVolume).toBe(40);
  });

  it("applies a patch, saves it and tells subscribers", () => {
    const { adapter, storage } = build();
    const listener = vi.fn();
    adapter.subscribe(listener);

    adapter.update({ inputGainDb: 6, echoCancellation: false });

    expect(adapter.getSnapshot()).toMatchObject({ inputGainDb: 6, echoCancellation: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({
      inputGainDb: 6,
      echoCancellation: false,
    });
  });

  it("keeps the other settings when a patch carries a version", () => {
    const { adapter } = build();
    adapter.update({ outputVolume: 30 });

    adapter.update({ version: 99, inputGainDb: 3 });

    expect(adapter.getSnapshot()).toMatchObject({ outputVolume: 30, inputGainDb: 3 });
    expect(adapter.getSnapshot().version).toBe(DEFAULT_SETTINGS.version);
  });

  it("stops notifying a subscriber that unsubscribed", () => {
    const { adapter } = build();
    const listener = vi.fn();
    adapter.subscribe(listener)();

    adapter.update({ outputVolume: 10 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("restores every default", () => {
    const { adapter } = build();
    adapter.update({ outputVolume: 10, noiseSuppression: "off", inputGate: false });

    adapter.reset();

    expect(adapter.getSnapshot()).toEqual(DEFAULT_SETTINGS);
  });
});
