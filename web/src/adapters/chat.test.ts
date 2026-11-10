import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeRealtimeClient, fakeApi } from "@/test/fakes";

import { createChatAdapter, createTypingAdapter } from "./chat";
import { ChannelReadStore } from "./readState";

afterEach(() => vi.useRealTimers());

describe("chat adapter", () => {
  it("passes channel pagination through to the HTTP API", async () => {
    const expected = { messages: [], nextCursor: "older-page", syncCursor: "4" };
    const listMessages = vi.fn(async () => expected);
    const api = fakeApi({
      listMessages,
    });
    const chat = createChatAdapter(api, new FakeRealtimeClient());

    await expect(
      chat.listMessages("channel-2", { cursor: "page-1", limit: 20 }),
    ).resolves.toBe(expected);
    expect(listMessages).toHaveBeenCalledWith("channel-2", {
      cursor: "page-1",
      limit: 20,
    });
  });

  it("persists a read watermark and publishes the authoritative timestamp", async () => {
    const markChannelRead = vi.fn(async (channelId: string) => ({
      channelId,
      lastReadAt: "2026-01-01T12:05:00Z",
    }));
    const reads = new ChannelReadStore();
    reads.hydrate({ "channel-2": "2026-01-01T12:00:00Z" });
    const changed = vi.fn();
    const chat = createChatAdapter(
      fakeApi({ markChannelRead }),
      new FakeRealtimeClient(),
      undefined,
      reads,
    );
    chat.onChannelReadChanged(changed);

    await chat.markChannelRead("channel-2");

    expect(markChannelRead).toHaveBeenCalledWith("channel-2");
    expect(chat.getReadState()["channel-2"]).toBe("2026-01-01T12:05:00Z");
    expect(changed).toHaveBeenCalledWith("channel-2", "2026-01-01T12:05:00Z");
    chat.dispose?.();
  });
});

describe("typing adapter", () => {
  it("sends at most once per channel window and expires received users", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const realtime = new FakeRealtimeClient();
    const sendTyping = vi.spyOn(realtime, "sendTyping");
    const typing = createTypingAdapter(realtime);
    const changed = vi.fn();
    typing.onTypingChanged(changed);

    typing.notifyTyping("channel-1");
    typing.notifyTyping("channel-1");
    typing.notifyTyping("channel-2");
    expect(sendTyping).toHaveBeenCalledTimes(2);

    realtime.push("TypingChanged", {
      channelId: "channel-1",
      userId: "u-ada",
      displayName: "Ada",
      expiresAt: "2026-01-01T12:00:06Z",
    });
    expect(changed).toHaveBeenLastCalledWith("channel-1", ["Ada"]);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(changed).toHaveBeenLastCalledWith("channel-1", []);
    typing.dispose?.();
  });
});
