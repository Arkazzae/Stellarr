import { describe, expect, it, vi } from "vitest";

import { ChannelReadStore } from "./readState";

describe("ChannelReadStore", () => {
  it("keeps the newest watermark when tabs race", () => {
    const store = new ChannelReadStore();
    const changed = vi.fn();
    store.hydrate({ general: "2026-01-01T12:00:00Z" });
    store.subscribe(changed);

    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:05:00Z" });
    store.apply({ channelId: "general", lastReadAt: "2026-01-01T12:03:00Z" });

    expect(store.snapshot().general).toBe("2026-01-01T12:05:00Z");
    expect(changed).toHaveBeenCalledOnce();
  });
});
