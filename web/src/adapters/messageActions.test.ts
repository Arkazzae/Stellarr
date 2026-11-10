import { describe, expect, it, vi } from "vitest";

import { FakeRealtimeClient, fakeApi, SELF, TEXT_CHANNEL } from "@/test/fakes";

import { createMessageActionsAdapter, ReactionStore } from "./messageActions";

describe("message actions adapter", () => {
  it("uses HTTP for reactions and applies realtime aggregates", async () => {
    const realtime = new FakeRealtimeClient();
    const store = new ReactionStore();
    store.setSelfUserId(SELF.id);
    store.ingest([
      {
        id: "m-1",
        channelId: TEXT_CHANNEL.id,
        author: { id: "u-2", displayName: "Ada" },
        content: "hej",
        attachments: [],
        embeds: [],
        reactions: [{ emoji: "👍", count: 1, mine: false }],
        createdAt: "2026-01-01T12:00:00Z",
      },
    ]);
    const setMessageReaction = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: "m-1",
        channelId: TEXT_CHANNEL.id,
        emoji: "👍",
        count: 2,
        userId: SELF.id,
        added: true,
      })
      .mockResolvedValueOnce({
        messageId: "m-1",
        channelId: TEXT_CHANNEL.id,
        emoji: "👍",
        count: 2,
        userId: SELF.id,
        added: false,
      });
    const actions = createMessageActionsAdapter(
      fakeApi({ setMessageReaction }),
      realtime,
      store,
    );

    await actions.react("m-1", "👍");
    expect(actions.getReactions("m-1")).toEqual([
      { emoji: "👍", count: 2, mine: true },
    ]);

    realtime.push("MessageReactionChanged", {
      messageId: "m-1",
      channelId: TEXT_CHANNEL.id,
      emoji: "👍",
      count: 3,
      userId: "u-3",
      added: true,
    });
    expect(actions.getReactions("m-1")).toEqual([
      { emoji: "👍", count: 3, mine: true },
    ]);

    await actions.unreact("m-1", "👍");
    expect(actions.getReactions("m-1")).toEqual([
      { emoji: "👍", count: 2, mine: false },
    ]);
    expect(setMessageReaction).toHaveBeenNthCalledWith(1, "m-1", "👍", true);
    expect(setMessageReaction).toHaveBeenNthCalledWith(2, "m-1", "👍", false);
    actions.dispose?.();
  });
});
