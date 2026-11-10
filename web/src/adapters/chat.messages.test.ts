import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/api/types";
import { probeMedia } from "@/lib/media/probe";
import { FakeRealtimeClient, fakeApi, SELF, TEXT_CHANNEL } from "@/test/fakes";

import { createChatAdapter } from "./chat";
import { ReactionStore } from "./messageActions";
import { ChannelReadStore } from "./readState";

vi.mock("@/lib/media/probe", () => ({ probeMedia: vi.fn(async () => ({ width: 640, height: 480 })) }));

const withReaction: Message = {
  id: "m-1",
  channelId: TEXT_CHANNEL.id,
  author: { id: "u-2", displayName: "Ada" },
  content: "hej",
  attachments: [],
  embeds: [],
  createdAt: "2026-01-01T12:00:00Z",
  reactions: [{ emoji: "👍", count: 2, mine: true }],
};

afterEach(() => vi.restoreAllMocks());

describe("chat adapter message reads", () => {
  it.each([
    [
      "a history page",
      (chat: ReturnType<typeof createChatAdapter>) => chat.listMessages(TEXT_CHANNEL.id),
      { listMessages: async () => ({ messages: [withReaction], nextCursor: null, syncCursor: "1" }) },
    ],
    [
      "a thread",
      (chat: ReturnType<typeof createChatAdapter>) => chat.getThread(TEXT_CHANNEL.id, "m-1"),
      { getThread: async () => [withReaction] },
    ],
    [
      "an indexed page",
      (chat: ReturnType<typeof createChatAdapter>) => chat.listIndexed(TEXT_CHANNEL.id, { kind: "all" }),
      { listIndexedMessages: async () => ({ messages: [withReaction], nextCursor: null }) },
    ],
    [
      "search results",
      (chat: ReturnType<typeof createChatAdapter>) => chat.search(TEXT_CHANNEL.id, "hej"),
      { searchMessages: async () => [withReaction] },
    ],
    [
      "the pinned list",
      (chat: ReturnType<typeof createChatAdapter>) => chat.listPinned(TEXT_CHANNEL.id),
      { listPinnedMessages: async () => [withReaction] },
    ],
  ])("hands the reactions of %s to the reaction store", async (_name, read, api) => {
    const reactions = new ReactionStore();
    const chat = createChatAdapter(fakeApi(api), new FakeRealtimeClient(), reactions);

    await read(chat);

    expect(reactions.get("m-1")).toEqual(withReaction.reactions);
  });

  it("hands the reactions of synced changes to the reaction store, skipping removals", async () => {
    const reactions = new ReactionStore();
    const chat = createChatAdapter(
      fakeApi({
        syncMessages: async () => ({
          changes: [
            { cursor: "1", kind: "upsert", messageId: "m-1", message: withReaction },
            { cursor: "2", kind: "delete", messageId: "m-gone" },
          ],
          nextCursor: "2",
          hasMore: false,
          resetRequired: false,
        }),
      }),
      new FakeRealtimeClient(),
      reactions,
    );

    await chat.syncMessages(TEXT_CHANNEL.id, "1");

    expect(reactions.get("m-1")).toEqual(withReaction.reactions);
    expect(reactions.get("m-gone")).toEqual([]);
  });
});

describe("chat adapter sending", () => {
  it("sends a reply reference only when the message is a reply", async () => {
    const sendMessage = vi.fn(fakeApi().sendMessage);
    const chat = createChatAdapter(fakeApi({ sendMessage }), new FakeRealtimeClient());
    const base = { channelId: TEXT_CHANNEL.id, content: "hej", attachmentIds: [], clientMessageId: "c-1" };

    await chat.send(base);
    await chat.send({ ...base, replyToMessageId: "m-1" });

    expect(sendMessage.mock.calls[0]?.[1]).not.toHaveProperty("replyToMessageId");
    expect(sendMessage.mock.calls[1]?.[1]).toMatchObject({ replyToMessageId: "m-1" });
  });

  it("hands the sent message to the reaction store and returns it", async () => {
    const reactions = new ReactionStore();
    const ingest = vi.spyOn(reactions, "ingest");
    const chat = createChatAdapter(fakeApi(), new FakeRealtimeClient(), reactions);

    const sent = await chat.send({
      channelId: TEXT_CHANNEL.id,
      content: "hej",
      attachmentIds: [],
      clientMessageId: "c-1",
    });

    expect(sent.author.id).toBe(SELF.id);
    expect(ingest).toHaveBeenCalledWith([sent]);
  });
});

describe("chat adapter uploads", () => {
  const file = new File(["x"], "clip.png", { type: "image/png" });

  it("uploads the file with the metadata the browser measured", async () => {
    const uploadAttachment = vi.fn(fakeApi().uploadAttachment);
    const chat = createChatAdapter(fakeApi({ uploadAttachment }), new FakeRealtimeClient());

    await chat.uploadAttachment(file);

    expect(probeMedia).toHaveBeenCalledWith(file);
    expect(uploadAttachment).toHaveBeenCalledWith(file, { width: 640, height: 480 });
  });

  it("adds the recorded duration and the voice message mark when the composer gives them", async () => {
    const uploadAttachment = vi.fn(fakeApi().uploadAttachment);
    const chat = createChatAdapter(fakeApi({ uploadAttachment }), new FakeRealtimeClient());

    await chat.uploadAttachment(file, { durationSeconds: 12.5, voiceMessage: true });

    expect(uploadAttachment).toHaveBeenCalledWith(file, {
      width: 640,
      height: 480,
      durationSeconds: 12.5,
      voiceMessage: true,
    });
  });
});

describe("chat adapter realtime", () => {
  it("forwards message events from the hub until the handler unsubscribes", () => {
    const realtime = new FakeRealtimeClient();
    const chat = createChatAdapter(fakeApi(), realtime);
    const created = vi.fn();
    const unsubscribe = chat.onMessage(created);

    realtime.push("MessageCreated", withReaction);
    unsubscribe();
    realtime.push("MessageCreated", withReaction);

    expect(created).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith(withReaction);
  });

  it("applies a read watermark pushed by another tab and stops after dispose", () => {
    const realtime = new FakeRealtimeClient();
    const reads = new ChannelReadStore();
    const chat = createChatAdapter(fakeApi(), realtime, undefined, reads);
    const changed = vi.fn();
    chat.onChannelReadChanged(changed);

    realtime.push("ChannelReadChanged", {
      channelId: TEXT_CHANNEL.id,
      lastReadAt: "2026-01-01T12:00:00Z",
    });
    chat.dispose?.();
    realtime.push("ChannelReadChanged", {
      channelId: TEXT_CHANNEL.id,
      lastReadAt: "2026-01-01T13:00:00Z",
    });

    expect(changed).toHaveBeenCalledTimes(1);
    expect(chat.getReadState()[TEXT_CHANNEL.id]).toBe("2026-01-01T12:00:00Z");
  });

  it("reports no reads and ignores read changes when no read store is wired", async () => {
    const chat = createChatAdapter(fakeApi(), new FakeRealtimeClient());

    await chat.markChannelRead(TEXT_CHANNEL.id);

    expect(chat.getReadState()).toEqual({});
    expect(() => chat.onChannelReadChanged(vi.fn())()).not.toThrow();
  });
});

describe("chat adapter focus", () => {
  it("joins the focused channel on the hub", async () => {
    const realtime = new FakeRealtimeClient();
    const joinChannel = vi.spyOn(realtime, "joinChannel");
    const chat = createChatAdapter(fakeApi(), realtime);

    await chat.focusChannel(TEXT_CHANNEL.id);

    expect(joinChannel).toHaveBeenCalledWith(TEXT_CHANNEL.id);
  });
});
