import { describe, expect, it } from "vitest";

import type { ThreadSummary } from "@/ports";
import { at, message } from "@/test/messages";

import { addThreadReply, isReply, retitleRoot, sortThreads } from "./threads";

const root = (id: string) => ({
  id,
  authorId: "u-ada",
  authorName: "Ada",
  preview: `root ${id}`,
});

function summary(id: string, replyCount: number, minute: number): ThreadSummary {
  return { channelId: "ch-general", root: root(id), replyCount, lastReplyAt: at(minute) };
}

function reply(id: string, rootId: string, minute: number) {
  const m = message(id, minute, { replyTo: root(rootId) });
  if (!isReply(m)) throw new Error("fixture is not a reply");
  return m;
}

describe("isReply", () => {
  it("tells an answer from a plain message", () => {
    expect(isReply(message("a", 1))).toBe(false);
    expect(isReply(message("b", 1, { replyTo: root("a") }))).toBe(true);
  });
});

describe("sortThreads", () => {
  it("orders by the newest reply, then by root id", () => {
    const sorted = sortThreads([summary("b", 1, 5), summary("c", 1, 9), summary("a", 1, 5)]);
    expect(sorted.map((t) => t.root.id)).toEqual(["c", "a", "b"]);
  });
});

describe("addThreadReply", () => {
  it("opens a thread on its first reply", () => {
    const next = addThreadReply(undefined, reply("r1", "root-1", 4));
    expect(next).toEqual([
      { channelId: "ch-general", root: root("root-1"), replyCount: 1, lastReplyAt: at(4) },
    ]);
  });

  it("counts on an existing thread and moves it to the top", () => {
    const current = [summary("quiet", 2, 9), summary("busy", 3, 5)];
    const next = addThreadReply(current, reply("r2", "busy", 12));
    expect(next.map((t) => [t.root.id, t.replyCount])).toEqual([
      ["busy", 4],
      ["quiet", 2],
    ]);
    expect(next[0]?.lastReplyAt).toBe(at(12));
    expect(current[1]?.replyCount).toBe(3);
  });
});

describe("retitleRoot", () => {
  it("re-quotes the root after it was edited", () => {
    const next = retitleRoot([summary("m1", 2, 3)], message("m1", 1, { content: "new words" }), "en");
    expect(next[0]?.root.preview).toBe("new words");
    expect(next[0]?.replyCount).toBe(2);
  });

  it("returns the same list for a message that roots no thread", () => {
    const threads = [summary("m1", 2, 3)];
    expect(retitleRoot(threads, message("other", 1), "en")).toBe(threads);
  });
});
