import { describe, expect, it, vi } from "vitest";

import { BOOTSTRAP, FakeRealtimeClient, SELF } from "@/test/fakes";

import { createPresenceAdapter } from "./presence";
import { DirectoryStore } from "./store";

describe("presence adapter", () => {
  it("round-trips a chosen status through realtime into the shared directory", async () => {
    const store = new DirectoryStore();
    store.hydrate(BOOTSTRAP);
    const realtime = new FakeRealtimeClient();
    const presence = createPresenceAdapter(store, realtime);
    const changed = vi.fn();
    const unsubscribe = presence.onPresenceChanged(changed);

    await presence.setPresence("dnd");

    expect(changed).toHaveBeenCalledWith(SELF.id, "dnd");
    expect(presence.presenceOf(SELF.id)).toBe("dnd");
    unsubscribe();
  });

  it("publishes voice occupancy to clients that are not in the call", () => {
    const store = new DirectoryStore();
    store.hydrate(BOOTSTRAP);
    const realtime = new FakeRealtimeClient();
    const presence = createPresenceAdapter(store, realtime);
    const changed = vi.fn();
    const unsubscribe = presence.onOccupantsChanged(changed);
    const participants = [
      { userId: SELF.id, displayName: SELF.displayName, muted: false },
    ];

    realtime.push("VoiceParticipantChanged", {
      channelId: "voice-salon",
      participants,
    });

    expect(changed).toHaveBeenCalledWith("voice-salon", participants);
    expect(presence.occupantsOf("voice-salon")).toEqual(participants);
    unsubscribe();
  });
});
