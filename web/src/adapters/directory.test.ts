import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_SERVER_STORAGE_KEY } from "@/lib/api/client";
import type { Bootstrap } from "@/lib/api/types";
import { BOOTSTRAP } from "@/test/fakes";

import { createDirectoryAdapter } from "./directory";
import { DirectoryStore } from "./store";

const ORBIT = { id: "srv-orbit", name: "Orbit" };
const HARBOR = { id: "srv-harbor", name: "Harbor" };

const LAYOUT: Bootstrap = {
  ...BOOTSTRAP,
  servers: [ORBIT, HARBOR],
  channels: [
    { id: "ch-a", name: "alpha", kind: "text", position: 0 },
    { id: "ch-b", name: "beta", kind: "text", position: 1 },
    { id: "ch-c", name: "gamma", kind: "voice", position: 2 },
  ],
  sections: [
    { id: "sec-1", name: "First", position: 0 },
    { id: "sec-2", name: "Second", position: 1 },
  ],
};

function hydratedStore(): DirectoryStore {
  const store = new DirectoryStore();
  store.hydrate(LAYOUT);
  return store;
}

afterEach(() => window.localStorage.clear());

describe("directory adapter reads", () => {
  it("falls back to a placeholder server before the bootstrap arrives", () => {
    const directory = createDirectoryAdapter(new DirectoryStore());

    expect(directory.getServer()).toEqual({ id: "", name: "Stellarr" });
    expect(directory.listChannels()).toEqual([]);
  });

  it("reflects the store and tells subscribers when it changes", () => {
    const store = hydratedStore();
    const directory = createDirectoryAdapter(store);
    const changed = vi.fn();
    const unsubscribe = directory.onChanged(changed);

    store.addSection({ id: "sec-3", name: "Third", position: 2 });

    expect(changed).toHaveBeenCalledOnce();
    expect(directory.listSections().map((section) => section.id)).toEqual([
      "sec-1",
      "sec-2",
      "sec-3",
    ]);
    unsubscribe();
    store.reset();
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe("directory adapter server switching", () => {
  it("remembers the chosen server for the next request", () => {
    const directory = createDirectoryAdapter(hydratedStore());

    directory.selectServer(HARBOR.id);

    expect(window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY)).toBe(HARBOR.id);
  });

  it("delegates creating and joining to the server actions", async () => {
    const created = { id: "srv-new", name: "New" };
    const actions = {
      create: vi.fn(async () => created),
      discover: vi.fn(async () => [HARBOR]),
      join: vi.fn(async () => HARBOR),
      joinInvite: vi.fn(async () => HARBOR),
    };
    const directory = createDirectoryAdapter(hydratedStore(), undefined, undefined, actions);

    await expect(directory.createServer({ name: "New" })).resolves.toBe(created);
    await expect(directory.discoverServers()).resolves.toEqual([HARBOR]);
    await expect(directory.joinServer(HARBOR.id)).resolves.toBe(HARBOR);
    await expect(directory.joinInvite("abc123")).resolves.toBe(HARBOR);
    expect(actions.create).toHaveBeenCalledWith({ name: "New" });
    expect(actions.join).toHaveBeenCalledWith(HARBOR.id);
    expect(actions.joinInvite).toHaveBeenCalledWith("abc123");
  });

  it("refuses to create or join without server actions and discovers nothing", async () => {
    const directory = createDirectoryAdapter(hydratedStore());

    await expect(directory.createServer({ name: "New" })).rejects.toThrow();
    await expect(directory.joinServer(HARBOR.id)).rejects.toThrow();
    await expect(directory.joinInvite("abc123")).rejects.toThrow();
    await expect(directory.discoverServers()).resolves.toEqual([]);
  });
});

describe("directory adapter reordering", () => {
  it("applies the new channel order at once and persists it", async () => {
    const store = hydratedStore();
    const persist = vi.fn(async () => undefined);
    const directory = createDirectoryAdapter(store, persist);

    const pending = directory.reorderChannels(["ch-c", "ch-a", "ch-b"]);

    expect(directory.listChannels().map((channel) => channel.id)).toEqual([
      "ch-c",
      "ch-a",
      "ch-b",
    ]);
    await pending;
    expect(persist).toHaveBeenCalledWith(["ch-c", "ch-a", "ch-b"]);
  });

  it("puts the previous channel order back and rethrows when persisting fails", async () => {
    const store = hydratedStore();
    const failure = new Error("offline");
    const directory = createDirectoryAdapter(store, async () => {
      throw failure;
    });

    await expect(directory.reorderChannels(["ch-c", "ch-b", "ch-a"])).rejects.toBe(failure);

    expect(directory.listChannels().map((channel) => channel.id)).toEqual([
      "ch-a",
      "ch-b",
      "ch-c",
    ]);
  });

  it("persists the section order and restores it on failure", async () => {
    const persistSections = vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"));
    const directory = createDirectoryAdapter(
      hydratedStore(),
      undefined,
      persistSections,
    );

    await directory.reorderSections(["sec-2", "sec-1"]);
    expect(persistSections).toHaveBeenLastCalledWith(["sec-2", "sec-1"]);
    expect(directory.listSections().map((section) => section.id)).toEqual([
      "sec-2",
      "sec-1",
    ]);

    await expect(directory.reorderSections(["sec-1", "sec-2"])).rejects.toThrow("offline");
    expect(directory.listSections().map((section) => section.id)).toEqual([
      "sec-2",
      "sec-1",
    ]);
  });

  it("keeps the local order when nothing is wired to persist it", async () => {
    const directory = createDirectoryAdapter(hydratedStore());

    await directory.reorderChannels(["ch-b", "ch-a", "ch-c"]);

    expect(directory.listChannels().map((channel) => channel.id)).toEqual([
      "ch-b",
      "ch-a",
      "ch-c",
    ]);
  });
});
