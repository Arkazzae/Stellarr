import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARTICIPANT_PREFERENCE,
  MAX_PARTICIPANT_PREFERENCES,
  PARTICIPANT_PREFERENCES_VERSION,
  ParticipantPreferencesStore,
  participantPreferencesKeyForUser,
} from "./participantPreferences";

function fakeStorage(seed: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage & { map: Map<string, string> };
}

describe("participant preferences", () => {
  it("answers with defaults for anyone it has not heard of", () => {
    const store = new ParticipantPreferencesStore(fakeStorage(), "me");
    expect(store.get("stranger")).toEqual(DEFAULT_PARTICIPANT_PREFERENCE);
  });

  it("remembers how a person sounds across a reload", () => {
    const storage = fakeStorage();
    const first = new ParticipantPreferencesStore(storage, "me");
    first.set("chewer", { gated: true });
    first.set("chewer", { volume: 60 });
    first.set("chewer", { suppressed: true });

    const second = new ParticipantPreferencesStore(storage, "me");
    expect(second.get("chewer")).toEqual({ volume: 60, gated: true, suppressed: true });
  });

  it("keeps each account's opinions to itself", () => {
    const storage = fakeStorage();
    new ParticipantPreferencesStore(storage, "me").set("chewer", { gated: true });
    expect(new ParticipantPreferencesStore(storage, "someone-else").get("chewer").gated).toBe(
      false,
    );
    expect(storage.map.has(participantPreferencesKeyForUser("me"))).toBe(true);
  });

  it("forgets a person set back to defaults rather than storing the absence", () => {
    const storage = fakeStorage();
    const store = new ParticipantPreferencesStore(storage, "me");
    store.set("chewer", { gated: true, volume: 40 });
    expect(store.size()).toBe(1);
    store.set("chewer", { gated: false, volume: 100 });
    expect(store.size()).toBe(0);
    expect(new ParticipantPreferencesStore(storage, "me").size()).toBe(0);
  });

  it("clamps a volume and ignores fields of the wrong type", () => {
    const store = new ParticipantPreferencesStore(fakeStorage(), "me");
    expect(store.set("chewer", { volume: 900 }).volume).toBe(200);
    expect(
      store.set("chewer", { gated: "yes" as unknown as boolean, volume: -5 }),
    ).toEqual({ volume: 0, gated: false, suppressed: false });
  });

  it("survives corrupt, foreign or outdated storage", () => {
    const key = participantPreferencesKeyForUser("me");
    expect(
      new ParticipantPreferencesStore(fakeStorage({ [key]: "{not json" }), "me").size(),
    ).toBe(0);
    expect(
      new ParticipantPreferencesStore(
        fakeStorage({ [key]: JSON.stringify({ version: 99, entries: { x: { gated: true } } }) }),
        "me",
      ).size(),
    ).toBe(0);
    const partlyBad = JSON.stringify({
      version: PARTICIPANT_PREFERENCES_VERSION,
      entries: {
        fine: { gated: true, at: 5 },
        odd: { volume: "loud", gated: 1 },
        list: [1, 2],
      },
    });
    const store = new ParticipantPreferencesStore(fakeStorage({ [key]: partlyBad }), "me");
    expect(store.get("fine").gated).toBe(true);
    expect(store.get("odd")).toEqual(DEFAULT_PARTICIPANT_PREFERENCE);
    expect(store.size()).toBe(1);
  });

  it("drops the people it has not touched longest once it is full", () => {
    let tick = 0;
    const store = new ParticipantPreferencesStore(fakeStorage(), "me", () => (tick += 1));
    for (let i = 0; i < MAX_PARTICIPANT_PREFERENCES + 5; i += 1) {
      store.set(`u-${i}`, { gated: true });
    }
    expect(store.size()).toBe(MAX_PARTICIPANT_PREFERENCES);
    expect(store.get("u-0").gated).toBe(false);
    expect(store.get("u-4").gated).toBe(false);
    expect(store.get("u-5").gated).toBe(true);
  });

  it("works in memory when storage is blocked or absent", () => {
    const store = new ParticipantPreferencesStore(null, "me");
    store.set("chewer", { suppressed: true });
    expect(store.get("chewer").suppressed).toBe(true);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const blocked = new ParticipantPreferencesStore(throwing, "me");
    expect(blocked.set("chewer", { gated: true }).gated).toBe(true);
    expect(blocked.get("chewer").gated).toBe(true);
  });

  it("loads the account's own namespace when the owner is named later", () => {
    const storage = fakeStorage();
    new ParticipantPreferencesStore(storage, "me").set("chewer", { gated: true });
    const store = new ParticipantPreferencesStore(storage);
    expect(store.get("chewer").gated).toBe(false);
    store.setOwner("me");
    expect(store.get("chewer").gated).toBe(true);
  });
});
