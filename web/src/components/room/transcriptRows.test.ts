import { describe, expect, it } from "vitest";

import type { MessageGroupVM } from "./MessageGroup";
import {
  indexOfMessage,
  messageTail,
  toRows,
  type TranscriptSectionVM,
} from "./transcriptRows";

function group(id: string, ...bodyIds: string[]): MessageGroupVM {
  return {
    id,
    authorId: "u1",
    authorName: "Ada",
    timestamp: "2026-08-14T10:00:00Z",
    bodies: (bodyIds.length > 0 ? bodyIds : [id]).map((bodyId) => ({
      id: bodyId,
      parts: [],
    })),
  };
}

const sections: TranscriptSectionVM[] = [
  { day: "Wczoraj", groups: [group("a"), group("b", "b1", "b2")] },
  { day: "Dzisiaj", groups: [group("c")] },
];

describe("toRows", () => {
  it("gives every day and every block a row of its own, in reading order", () => {
    expect(toRows(sections, null).map((row) => `${row.kind}:${row.id}`)).toEqual([
      "day:day-Wczoraj",
      "group:a",
      "group:b",
      "day:day-Dzisiaj",
      "group:c",
    ]);
  });

  it("puts the unread line directly above the first unread block, even across a day", () => {
    expect(toRows(sections, "c").map((row) => row.kind)).toEqual([
      "day",
      "group",
      "group",
      "day",
      "unread",
      "group",
    ]);
  });

  it("adds no unread line when the block is not in the list", () => {
    expect(toRows(sections, "gone").some((row) => row.kind === "unread")).toBe(false);
  });

  it("is empty for an empty transcript", () => {
    expect(toRows([], null)).toEqual([]);
  });
});

describe("messageTail", () => {
  it("counts messages, not blocks, and names the newest one", () => {
    expect(messageTail(toRows(sections, null))).toEqual({
      count: 4,
      lastMessageId: "c",
    });
  });

  it("has no newest message in an empty transcript", () => {
    expect(messageTail([])).toEqual({ count: 0, lastMessageId: undefined });
  });
});

describe("indexOfMessage", () => {
  const rows = toRows(sections, "b");

  it("finds a block by its own id", () => {
    expect(indexOfMessage(rows, "b")).toBe(3);
  });

  it("finds the block that holds a later message of a run", () => {
    expect(indexOfMessage(rows, "b2")).toBe(3);
  });

  it("does not mistake a separator for a message", () => {
    expect(indexOfMessage(rows, "day-Wczoraj")).toBe(-1);
    expect(indexOfMessage(rows, "unread-b")).toBe(-1);
  });

  it("answers -1 for a message outside the loaded window", () => {
    expect(indexOfMessage(rows, "older")).toBe(-1);
  });
});
