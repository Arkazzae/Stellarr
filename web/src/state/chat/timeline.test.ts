import { describe, expect, it } from "vitest";

import { message } from "@/test/messages";

import {
  applySyncChanges,
  mergeAll,
  mergeMessage,
  reconcileLatest,
  removeMessage,
  resetWindow,
  settleOptimistic,
  updateLoaded,
} from "./timeline";

const ids = (messages: readonly { id: string }[]) => messages.map((m) => m.id);

describe("mergeMessage", () => {
  it("places a new message by time, with the id breaking a tie", () => {
    const bucket = [message("a", 1), message("d", 4)];
    const merged = mergeMessage(bucket, message("c", 2));
    expect(ids(mergeMessage(merged, message("b", 2)))).toEqual(["a", "b", "c", "d"]);
  });

  it("replaces a known id where it is instead of doubling or moving it", () => {
    const bucket = [message("a", 1), message("b", 2), message("c", 3)];
    const edited = message("b", 9, { content: "edited" });
    const merged = mergeMessage(bucket, edited);
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged[1]?.content).toBe("edited");
    expect(bucket[1]?.content).toBe("content of b");
  });

  it("starts a bucket that does not exist yet", () => {
    expect(ids(mergeMessage(undefined, message("a", 1)))).toEqual(["a"]);
  });
});

describe("mergeAll", () => {
  it("folds a page into the bucket without duplicates", () => {
    const merged = mergeAll([message("b", 2)], [message("a", 1), message("b", 2)]);
    expect(ids(merged)).toEqual(["a", "b"]);
  });
});

describe("reconcileLatest", () => {
  const pending = new Set(["draft"]);

  it("keeps older pages, takes the server window and drops what it no longer lists", () => {
    const current = [
      message("old", 1),
      message("kept", 6),
      message("gone", 7),
    ];
    const latest = [message("kept", 6, { content: "fresh" }), message("new", 8)];
    const next = reconcileLatest(current, latest, new Set());
    expect(ids(next)).toEqual(["old", "kept", "new"]);
    expect(next[1]?.content).toBe("fresh");
  });

  it("keeps an optimistic send the server has not seen yet", () => {
    const current = [message("kept", 6), message("draft", 8)];
    const next = reconcileLatest(current, [message("kept", 6)], pending);
    expect(ids(next)).toEqual(["kept", "draft"]);
  });

  it("keeps only the unsent messages when the server window is empty", () => {
    const next = reconcileLatest([message("a", 1), message("draft", 2)], [], pending);
    expect(ids(next)).toEqual(["draft"]);
  });

  it("builds the bucket from nothing", () => {
    expect(ids(reconcileLatest(undefined, [message("a", 1)], new Set()))).toEqual(["a"]);
  });
});

describe("resetWindow", () => {
  it("keeps only unsent messages under the fresh page", () => {
    const next = resetWindow(
      [message("old", 1), message("draft", 9)],
      [message("a", 2), message("b", 3)],
      new Set(["draft"]),
    );
    expect(ids(next)).toEqual(["a", "b", "draft"]);
  });
});

describe("applySyncChanges", () => {
  it("replays upserts and deletes in journal order", () => {
    const bucket = [message("a", 1), message("b", 2)];
    const next = applySyncChanges(bucket, [
      { cursor: "1", kind: "upsert", messageId: "c", message: message("c", 3) },
      { cursor: "2", kind: "delete", messageId: "a" },
      { cursor: "3", kind: "upsert", messageId: "b", message: message("b", 2, { content: "b2" }) },
    ]);
    expect(ids(next)).toEqual(["b", "c"]);
    expect(next[0]?.content).toBe("b2");
  });

  it("treats an upsert that carries no message as a removal", () => {
    const next = applySyncChanges([message("a", 1)], [
      { cursor: "1", kind: "upsert", messageId: "a" },
    ]);
    expect(next).toEqual([]);
  });

  it("lets a later change undo an earlier one", () => {
    const next = applySyncChanges(undefined, [
      { cursor: "1", kind: "upsert", messageId: "a", message: message("a", 1) },
      { cursor: "2", kind: "delete", messageId: "a" },
    ]);
    expect(next).toEqual([]);
  });
});

describe("removeMessage and updateLoaded", () => {
  const bucket = [message("a", 1), message("b", 2)];

  it("hand back the same bucket when the message is not there", () => {
    expect(removeMessage(bucket, "zzz")).toBe(bucket);
    expect(updateLoaded(bucket, "zzz", (m) => ({ ...m, content: "x" }))).toBe(bucket);
  });

  it("change only the message they name", () => {
    expect(ids(removeMessage(bucket, "a"))).toEqual(["b"]);
    const next = updateLoaded(bucket, "b", (m) => ({ ...m, content: "x" }));
    expect(next.map((m) => m.content)).toEqual(["content of a", "x"]);
  });
});

describe("settleOptimistic", () => {
  it("swaps the placeholder for the server's copy in one step", () => {
    const next = settleOptimistic(
      [message("a", 1), message("local", 5)],
      "local",
      message("server", 6),
    );
    expect(ids(next)).toEqual(["a", "server"]);
  });

  it("does not double a copy that already arrived over the socket", () => {
    const next = settleOptimistic(
      [message("local", 5), message("server", 6)],
      "local",
      message("server", 6, { content: "from http" }),
    );
    expect(ids(next)).toEqual(["server"]);
    expect(next[0]?.content).toBe("from http");
  });
});
