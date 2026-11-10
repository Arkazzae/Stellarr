import { describe, expect, it, vi } from "vitest";

import { ChannelReadStore } from "./readState";

describe("ChannelReadStore watermarks", () => {
  it("starts from no reads when the bootstrap carries none", () => {
    const store = new ChannelReadStore();
    store.hydrate({ general: "2026-01-01T12:00:00Z" });

    store.hydrate(undefined);

    expect(store.snapshot()).toEqual({});
  });

  it("announces the first watermark of a channel and each later advance", () => {
    const store = new ChannelReadStore();
    const changed = vi.fn();
    store.subscribe(changed);

    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:00:00Z" });
    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:01:00Z" });

    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith({
      channelId: "general",
      lastReadAt: "2026-01-01T12:01:00Z",
    });
  });

  it("ignores an update with the same time as the current watermark", () => {
    const store = new ChannelReadStore();
    store.hydrate({ general: "2026-01-01T12:00:00Z" });
    const changed = vi.fn();
    store.subscribe(changed);

    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:00:00Z" });

    expect(changed).not.toHaveBeenCalled();
  });

  it("compares instants, not strings, across time zone notations", () => {
    const store = new ChannelReadStore();
    store.hydrate({ general: "2026-01-01T12:00:00Z" });

    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:30:00+02:00" });

    expect(store.snapshot().general).toBe("2026-01-01T12:00:00Z");
  });

  it("tracks channels independently and replaces the snapshot object on change", () => {
    const store = new ChannelReadStore();
    store.hydrate({ general: "2026-01-01T12:00:00Z" });
    const before = store.snapshot();

    store.apply({ channelId: "random", lastReadAt: "2026-01-01T11:00:00Z" });

    expect(store.snapshot()).not.toBe(before);
    expect(before).toEqual({ general: "2026-01-01T12:00:00Z" });
    expect(store.snapshot()).toEqual({
      general: "2026-01-01T12:00:00Z",
      random: "2026-01-01T11:00:00Z",
    });
  });

  it("stops announcing to an unsubscribed handler and forgets reads on reset", () => {
    const store = new ChannelReadStore();
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    unsubscribe();

    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:00:00Z" });
    store.reset();

    expect(changed).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual({});
  });
});
