import { describe, expect, it, vi } from "vitest";

import type { Bootstrap, Channel, User } from "@/lib/api/types";
import { BOOTSTRAP, SELF } from "@/test/fakes";

import { DirectoryStore } from "./store";

const JO: User = { id: "u-jo", username: "jo", displayName: "Jo", presence: "offline" };

function channel(id: string, name: string, extra: Partial<Channel> = {}): Channel {
  return { id, name, kind: "text", ...extra };
}

function storeWith(overrides: Partial<Bootstrap> = {}): DirectoryStore {
  const store = new DirectoryStore();
  store.hydrate({ ...BOOTSTRAP, ...overrides });
  return store;
}

const ids = (items: { id: string }[]): string[] => items.map((item) => item.id);

describe("DirectoryStore snapshots", () => {
  it("starts empty and publishes a new snapshot object for every change", () => {
    const store = new DirectoryStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const empty = store.getSnapshot();
    expect(empty.server).toBeNull();

    store.hydrate(BOOTSTRAP);
    const hydrated = store.getSnapshot();
    store.setPresence(SELF.id, "dnd");

    expect(hydrated).not.toBe(empty);
    expect(store.getSnapshot()).not.toBe(hydrated);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying an unsubscribed listener and returns to empty on reset", () => {
    const store = storeWith();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.reset();

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().members).toEqual([]);
    expect(store.getSnapshot().server).toBeNull();
  });

  it("orders channels by position then name and sections by position then name", () => {
    const store = storeWith({
      channels: [
        channel("c-3", "zeta", { position: 1 }),
        channel("c-2", "beta", { position: 0 }),
        channel("c-1", "alpha", { position: 0 }),
      ],
      sections: [
        { id: "s-2", name: "Later", position: 1 },
        { id: "s-1", name: "Earlier", position: 0 },
      ],
    });

    expect(ids(store.getSnapshot().channels)).toEqual(["c-1", "c-2", "c-3"]);
    expect(ids(store.getSnapshot().sections)).toEqual(["s-1", "s-2"]);
  });

  it("keeps occupancy from the bootstrap and defaults it to none", () => {
    const occupant = { userId: SELF.id, displayName: SELF.displayName, muted: false };

    expect(storeWith({ voice: { "ch-salon": [occupant] } }).getSnapshot().occupancy).toEqual({
      "ch-salon": [occupant],
    });
    expect(storeWith().getSnapshot().occupancy).toEqual({});
  });
});

describe("DirectoryStore members", () => {
  it("changes only the presence of the named member", () => {
    const store = storeWith({ members: [SELF, JO] });

    store.setPresence(JO.id, "online");

    expect(store.getSnapshot().members).toEqual([SELF, { ...JO, presence: "online" }]);
  });

  it("replaces a member with the updated profile", () => {
    const store = storeWith({ members: [SELF, JO] });
    const renamed = { ...JO, displayName: "Joanna" };

    store.setUser(renamed);

    expect(store.getSnapshot().members[1]).toBe(renamed);
  });
});

describe("DirectoryStore server", () => {
  it("updates the active server and its entry in the server list", () => {
    const store = storeWith();
    const renamed = { id: BOOTSTRAP.server.id, name: "Orbit Prime" };

    store.setServer(renamed);

    expect(store.getSnapshot().server).toBe(renamed);
    expect(store.getSnapshot().servers).toEqual([renamed]);
  });

  it("sets and clears the server icon", () => {
    const store = storeWith();

    store.setServerIcon("/icons/orbit.png");
    expect(store.getSnapshot().server?.iconUrl).toBe("/icons/orbit.png");

    store.setServerIcon(undefined);
    expect(store.getSnapshot().server).toEqual(BOOTSTRAP.server);
    expect(store.getSnapshot().server).not.toHaveProperty("iconUrl");
  });

  it("ignores an icon change before a server is loaded", () => {
    const store = new DirectoryStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setServerIcon("/icons/orbit.png");

    expect(store.getSnapshot().server).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it("copies the permissions it is given", () => {
    const store = storeWith();
    const permissions: ("manageServer" | "manageChannels")[] = ["manageServer"];

    store.setPermissions(permissions);
    permissions.push("manageChannels");

    expect(store.getSnapshot().permissions).toEqual(["manageServer"]);
  });
});

describe("DirectoryStore channels", () => {
  const three = [
    channel("c-1", "alpha", { position: 0 }),
    channel("c-2", "beta", { position: 1 }),
    channel("c-3", "gamma", { position: 2 }),
  ];

  it("adds a channel in its place and patches settings of one channel", () => {
    const store = storeWith({ channels: three });

    store.addChannel(channel("c-4", "between", { position: 0.5 }));
    store.setChannelSettings("c-2", { topic: "Plans" });

    expect(ids(store.getSnapshot().channels)).toEqual(["c-1", "c-4", "c-2", "c-3"]);
    expect(store.getSnapshot().channels.map((item) => item.topic)).toEqual([
      undefined,
      undefined,
      "Plans",
      undefined,
    ]);
  });

  it("puts channels missing from a new order after the listed ones", () => {
    const store = storeWith({ channels: three });

    store.setChannelOrder(["c-3"]);

    expect(ids(store.getSnapshot().channels)).toEqual(["c-3", "c-1", "c-2"]);
  });

  it("drops the voice occupancy of a removed channel", () => {
    const occupant = { userId: SELF.id, displayName: SELF.displayName, muted: false };
    const store = storeWith({
      channels: three,
      voice: { "c-1": [occupant], "c-2": [occupant] },
    });

    store.removeChannel("c-1");

    expect(ids(store.getSnapshot().channels)).toEqual(["c-2", "c-3"]);
    expect(store.getSnapshot().occupancy).toEqual({ "c-2": [occupant] });
  });

  it("replaces the occupants of one voice channel", () => {
    const store = storeWith({ channels: three });
    const occupants = [{ userId: JO.id, displayName: JO.displayName, muted: true }];

    store.setOccupants("c-3", occupants);

    expect(store.getSnapshot().occupancy["c-3"]).toBe(occupants);
  });
});

describe("DirectoryStore sections", () => {
  const sections = [
    { id: "s-1", name: "One", position: 0 },
    { id: "s-2", name: "Two", position: 1 },
  ];

  it("adds, renames and reorders sections", () => {
    const store = storeWith({ sections });

    store.addSection({ id: "s-3", name: "Three", position: 2 });
    store.setSection({ id: "s-1", name: "Uno", position: 0 });
    store.setSectionOrder(["s-3", "s-1", "s-2"]);

    expect(store.getSnapshot().sections.map((item) => item.name)).toEqual([
      "Three",
      "Uno",
      "Two",
    ]);
  });

  it("unassigns channels that sat in a removed section", () => {
    const store = storeWith({
      sections,
      channels: [
        channel("c-1", "alpha", { sectionId: "s-1" }),
        channel("c-2", "beta", { sectionId: "s-2" }),
        channel("c-3", "gamma"),
      ],
    });

    store.removeSection("s-1");

    expect(ids(store.getSnapshot().sections)).toEqual(["s-2"]);
    expect(store.getSnapshot().channels[0]).toEqual(channel("c-1", "alpha"));
    expect(store.getSnapshot().channels[0]).not.toHaveProperty("sectionId");
    expect(store.getSnapshot().channels[1]?.sectionId).toBe("s-2");
  });
});
