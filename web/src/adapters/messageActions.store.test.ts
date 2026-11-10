import { describe, expect, it, vi } from "vitest";

import type { Message, MessageReactionChanged } from "@/lib/api/types";
import { FakeRealtimeClient, fakeApi, SELF, TEXT_CHANNEL } from "@/test/fakes";

import { createMessageActionsAdapter, ReactionStore } from "./messageActions";

function message(id: string, reactions?: Message["reactions"]): Message {
  return {
    id,
    channelId: TEXT_CHANNEL.id,
    author: { id: "u-2", displayName: "Ada" },
    content: "hej",
    attachments: [],
    embeds: [],
    createdAt: "2026-01-01T12:00:00Z",
    ...(reactions === undefined ? {} : { reactions }),
  };
}

function change(overrides: Partial<MessageReactionChanged>): MessageReactionChanged {
  return {
    messageId: "m-1",
    channelId: TEXT_CHANNEL.id,
    emoji: "👍",
    count: 1,
    userId: "u-3",
    added: true,
    ...overrides,
  };
}

describe("ReactionStore", () => {
  it("has no reactions for a message it has not seen", () => {
    expect(new ReactionStore().get("m-unknown")).toEqual([]);
  });

  it("does not let a history page replace a newer hub aggregate", () => {
    const store = new ReactionStore();
    store.apply(change({ count: 4 }));

    store.ingest([message("m-1", [{ emoji: "👍", count: 1, mine: false }])]);

    expect(store.get("m-1")).toEqual([{ emoji: "👍", count: 4, mine: false }]);
  });

  it("hands out copies, so a caller cannot change the stored counts", () => {
    const store = new ReactionStore();
    store.ingest([message("m-1", [{ emoji: "👍", count: 1, mine: false }])]);

    store.get("m-1")[0]!.count = 99;

    expect(store.get("m-1")[0]?.count).toBe(1);
  });

  it("keeps mine unless the update is about the signed-in user", () => {
    const store = new ReactionStore();
    store.setSelfUserId(SELF.id);
    store.ingest([message("m-1", [{ emoji: "👍", count: 1, mine: true }])]);

    store.apply(change({ count: 2, userId: "u-3" }));
    expect(store.get("m-1")).toEqual([{ emoji: "👍", count: 2, mine: true }]);

    store.apply(change({ count: 1, userId: SELF.id, added: false }));
    expect(store.get("m-1")).toEqual([{ emoji: "👍", count: 1, mine: false }]);
  });

  it("drops an emoji whose count falls to zero", () => {
    const store = new ReactionStore();
    store.ingest([
      message("m-1", [
        { emoji: "👍", count: 1, mine: false },
        { emoji: "🎉", count: 2, mine: false },
      ]),
    ]);

    store.apply(change({ count: 0, added: false }));

    expect(store.get("m-1")).toEqual([{ emoji: "🎉", count: 2, mine: false }]);
  });

  it("announces a change with copies and stays silent when nothing changed", () => {
    const store = new ReactionStore();
    const changed = vi.fn();
    store.subscribe(changed);

    store.apply(change({ count: 0 }));
    expect(changed).not.toHaveBeenCalled();

    store.apply(change({ count: 2 }));
    store.apply(change({ count: 2 }));
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith("m-1", [{ emoji: "👍", count: 2, mine: false }]);
  });

  it("forgets every message and the signed-in user on reset", () => {
    const store = new ReactionStore();
    store.setSelfUserId(SELF.id);
    store.apply(change({ userId: SELF.id }));

    store.reset();
    store.apply(change({ count: 2, userId: SELF.id }));

    expect(store.get("m-1")).toEqual([{ emoji: "👍", count: 2, mine: false }]);
  });
});

describe("message actions adapter", () => {
  it("forwards edits, deletions and pins to the API", async () => {
    const api = fakeApi();
    const actions = createMessageActionsAdapter(
      api,
      new FakeRealtimeClient(),
      new ReactionStore(),
    );

    await actions.edit("m-1", "poprawione");
    await actions.remove("m-1");
    await actions.setPinned("m-1", true);

    expect(api.editMessage).toHaveBeenCalledWith("m-1", "poprawione");
    expect(api.deleteMessage).toHaveBeenCalledWith("m-1");
    expect(api.setMessagePinned).toHaveBeenCalledWith("m-1", true);
    actions.dispose?.();
  });

  it("tells subscribers about reactions and stops listening to the hub on dispose", () => {
    const realtime = new FakeRealtimeClient();
    const actions = createMessageActionsAdapter(fakeApi(), realtime, new ReactionStore());
    const changed = vi.fn();
    actions.onReactionsChanged(changed);

    realtime.push("MessageReactionChanged", change({ count: 1 }));
    expect(changed).toHaveBeenCalledWith("m-1", [{ emoji: "👍", count: 1, mine: false }]);

    actions.dispose?.();
    realtime.push("MessageReactionChanged", change({ count: 2 }));
    expect(changed).toHaveBeenCalledOnce();
  });
});
