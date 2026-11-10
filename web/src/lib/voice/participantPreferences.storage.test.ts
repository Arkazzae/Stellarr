import { describe, expect, it } from "vitest";

import {
  PARTICIPANT_PREFERENCES_VERSION,
  ParticipantPreferencesStore,
  participantPreferencesKeyForUser,
} from "./participantPreferences";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as Storage;
  return { map, storage };
}

describe("participant preference storage", () => {
  it("writes only what differs from the defaults, with the time of the change", () => {
    const { map, storage } = memoryStorage();
    const store = new ParticipantPreferencesStore(storage, "me", () => 1234);

    store.set("quiet", { volume: 30 });
    store.set("gated", { gated: true });
    store.set("both", { suppressed: true, volume: 150 });

    expect(JSON.parse(map.get(participantPreferencesKeyForUser("me"))!)).toEqual({
      version: PARTICIPANT_PREFERENCES_VERSION,
      entries: {
        quiet: { volume: 30, at: 1234 },
        gated: { gated: true, at: 1234 },
        both: { volume: 150, suppressed: true, at: 1234 },
      },
    });
  });

  it("reads back what an earlier build stored, including a missing timestamp", () => {
    const key = participantPreferencesKeyForUser("me");
    const { storage } = memoryStorage({
      [key]: JSON.stringify({
        version: PARTICIPANT_PREFERENCES_VERSION,
        entries: { ada: { volume: 250, suppressed: true }, bob: { volume: 100 } },
      }),
    });

    const store = new ParticipantPreferencesStore(storage, "me");

    expect(store.get("ada")).toEqual({ volume: 200, gated: false, suppressed: true });
    expect(store.size()).toBe(1);
  });

  it("keeps the oldest entry's age across a reload so it is still the first to go", () => {
    const { storage } = memoryStorage();
    const first = new ParticipantPreferencesStore(storage, "me", () => 10);
    first.set("old", { gated: true });
    const second = new ParticipantPreferencesStore(storage, "me", () => 20);
    second.set("new", { gated: true });

    const key = participantPreferencesKeyForUser("me");
    const stored = JSON.parse(storage.getItem(key)!) as {
      entries: Record<string, { at: number }>;
    };
    expect(stored.entries["old"]?.at).toBe(10);
    expect(stored.entries["new"]?.at).toBe(20);
  });

  it("persists nothing until an account is named", () => {
    const { map, storage } = memoryStorage();
    const store = new ParticipantPreferencesStore(storage);

    store.set("ada", { gated: true });

    expect(store.get("ada").gated).toBe(true);
    expect(map.size).toBe(0);
  });

  it("shows the other account's preferences, not the previous one's, after a switch", () => {
    const { storage } = memoryStorage();
    new ParticipantPreferencesStore(storage, "bob").set("ada", { volume: 20 });
    const store = new ParticipantPreferencesStore(storage, "me");
    store.set("ada", { gated: true });

    store.setOwner("bob");

    expect(store.get("ada")).toEqual({ volume: 20, gated: false, suppressed: false });
    store.setOwner("me");
    expect(store.get("ada")).toEqual({ volume: 100, gated: true, suppressed: false });
  });

  it("does not reload when the same account is named again", () => {
    const { storage } = memoryStorage();
    const store = new ParticipantPreferencesStore(storage, "me");
    store.set("ada", { gated: true });

    store.setOwner("me");

    expect(store.get("ada").gated).toBe(true);
  });

  it("tells the caller the change it made even when the write is refused", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    } as unknown as Storage;
    const store = new ParticipantPreferencesStore(storage, "me");

    expect(store.set("ada", { volume: 40 })).toEqual({
      volume: 40,
      gated: false,
      suppressed: false,
    });
    expect(store.get("ada").volume).toBe(40);
  });

  it("returns copies, so changing an answer does not change the store", () => {
    const store = new ParticipantPreferencesStore(null, "me");
    store.set("ada", { gated: true });

    store.get("ada").gated = false;

    expect(store.get("ada").gated).toBe(true);
  });
});
