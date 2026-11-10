import { describe, expect, it } from "vitest";

import { at, message } from "@/test/messages";

import { advanceReadMark, unreadCounts } from "./readMarks";

describe("advanceReadMark", () => {
  it("moves a mark forward", () => {
    expect(advanceReadMark({ a: at(1) }, "a", at(5))).toEqual({ a: at(5) });
  });

  it("adds a mark for a channel that had none", () => {
    expect(advanceReadMark({}, "a", at(5))).toEqual({ a: at(5) });
  });

  it("ignores an older or equal mark and keeps the same object", () => {
    const marks = { a: at(5) };
    expect(advanceReadMark(marks, "a", at(2))).toBe(marks);
    expect(advanceReadMark(marks, "a", at(5))).toBe(marks);
  });
});

describe("unreadCounts", () => {
  const theirs = (id: string, minute: number, channelId: string) =>
    message(id, minute, { channelId });

  it("counts what arrived after each mark, skipping the open channel", () => {
    const counts = unreadCounts(
      {
        a: [theirs("a1", 5, "a"), theirs("a2", 6, "a")],
        b: [theirs("b1", 5, "b")],
        open: [theirs("o1", 9, "open")],
      },
      { a: at(5), b: at(1) },
      at(0),
      "open",
      "u-maja",
    );
    expect(counts).toEqual({ a: 1, b: 1 });
  });

  it("counts from the moment the tab opened when a channel has no mark", () => {
    const counts = unreadCounts(
      { a: [theirs("a1", 2, "a"), theirs("a2", 8, "a")] },
      {},
      at(5),
      null,
      "u-maja",
    );
    expect(counts).toEqual({ a: 1 });
  });

  it("leaves out your own messages and channels with nothing new", () => {
    const own = message("mine", 9, { channelId: "a", author: { id: "u-maja", displayName: "Maja" } });
    expect(unreadCounts({ a: [own] }, {}, at(0), null, "u-maja")).toEqual({});
  });
});
