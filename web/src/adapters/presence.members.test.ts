import { describe, expect, it, vi } from "vitest";

import { BOOTSTRAP, FakeRealtimeClient, SELF, VOICE_CHANNEL } from "@/test/fakes";

import { createConnectionAdapter, createPresenceAdapter } from "./presence";
import { DirectoryStore } from "./store";

function setup() {
  const store = new DirectoryStore();
  store.hydrate(BOOTSTRAP);
  const realtime = new FakeRealtimeClient();
  return { store, realtime, presence: createPresenceAdapter(store, realtime) };
}

describe("presence adapter members", () => {
  it("lists the members of the shared directory", () => {
    const { presence } = setup();

    expect(presence.listMembers()).toEqual([SELF]);
  });

  it("reports a user the directory does not know as offline", () => {
    const { presence } = setup();

    expect(presence.presenceOf("u-stranger")).toBe("offline");
  });

  it("stops calling a handler once it has unsubscribed", () => {
    const { presence, realtime } = setup();
    const listener = vi.fn();
    const unsubscribe = presence.onPresenceChanged(listener);
    unsubscribe();

    realtime.push("PresenceChanged", { userId: SELF.id, presence: "idle" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("has nobody in a voice channel until the hub says otherwise", () => {
    const { presence } = setup();

    expect(presence.occupantsOf(VOICE_CHANNEL.id)).toEqual([]);
  });
});

describe("connection adapter", () => {
  it("follows the realtime client status and tells subscribers when it changes", async () => {
    const realtime = new FakeRealtimeClient();
    const connection = createConnectionAdapter(realtime);
    const listener = vi.fn();
    const unsubscribe = connection.subscribe(listener);
    expect(connection.getStatus()).toBe("idle");

    await realtime.start();

    expect(connection.getStatus()).toBe("connected");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await realtime.stop();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
