import { describe, expect, it } from "vitest";

import type { Bootstrap } from "@/lib/api/types";

import { DirectoryStore } from "./store";

describe("DirectoryStore moderation updates", () => {
  it("removes a kicked member from the roster and every voice channel", () => {
    const store = new DirectoryStore();
    store.hydrate({
      user: { id: "u-1", username: "maja", displayName: "Maja", presence: "online" },
      server: { id: "s-1", name: "Orbit" },
      servers: [{ id: "s-1", name: "Orbit" }],
      channels: [{ id: "v-1", name: "Salon", kind: "voice" }],
      sections: [],
      members: [
        { id: "u-1", username: "maja", displayName: "Maja", presence: "online" },
        { id: "u-2", username: "jo", displayName: "Jo", presence: "online" },
      ],
      permissions: [],
      messages: [],
      voice: {
        "v-1": [
          { userId: "u-1", displayName: "Maja", muted: false },
          { userId: "u-2", displayName: "Jo", muted: true },
        ],
      },
    } satisfies Bootstrap);

    store.removeMember("u-2");

    expect(store.getSnapshot().members.map((member) => member.id)).toEqual(["u-1"]);
    expect(store.getSnapshot().occupancy["v-1"]?.map((person) => person.userId)).toEqual([
      "u-1",
    ]);
  });
});
