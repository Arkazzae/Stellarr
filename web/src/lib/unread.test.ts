import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/api/types";

import { countUnread, findFirstUnreadGroup, type UnreadGroup } from "./unread";

const MARK = "2026-08-13T12:00:00.000Z";

function message(
  id: string,
  authorId: string,
  createdAt: string,
): Message {
  return {
    id,
    channelId: "c-1",
    author: { id: authorId, displayName: authorId },
    content: "cześć",
    attachments: [],
    embeds: [],
    createdAt,
  };
}

describe("countUnread", () => {
  it("counts only what arrived after the mark", () => {
    const messages = [
      message("m1", "u-ada", "2026-08-13T11:59:00.000Z"),
      message("m2", "u-ada", "2026-08-13T12:00:00.000Z"),
      message("m3", "u-ada", "2026-08-13T12:00:01.000Z"),
      message("m4", "u-nils", "2026-08-13T12:05:00.000Z"),
    ];
    expect(countUnread(messages, MARK, "u-me")).toBe(2);
  });

  it("ignores your own messages and server notices", () => {
    const messages = [
      message("m1", "u-me", "2026-08-13T12:01:00.000Z"),
      message("m2", "system", "2026-08-13T12:02:00.000Z"),
      message("m3", "u-ada", "2026-08-13T12:03:00.000Z"),
    ];
    expect(countUnread(messages, MARK, "u-me")).toBe(1);
  });
});

describe("findFirstUnreadGroup", () => {
  const groups: UnreadGroup[] = [
    { id: "g1", authorId: "u-ada", timestamp: "2026-08-13T11:00:00.000Z" },
    { id: "g2", authorId: "u-ada", timestamp: "2026-08-13T12:01:00.000Z" },
    { id: "g3", authorId: "u-nils", timestamp: "2026-08-13T12:02:00.000Z" },
  ];

  it("points at the first block past the mark", () => {
    expect(findFirstUnreadGroup(groups, MARK, "u-me")).toBe("g2");
  });

  it("is null when nothing arrived after the mark", () => {
    expect(
      findFirstUnreadGroup(groups, "2026-08-13T23:00:00.000Z", "u-me"),
    ).toBeNull();
  });

  it("clears everything above a block you wrote yourself", () => {
    const withMine: UnreadGroup[] = [
      ...groups,
      { id: "g4", authorId: "u-me", timestamp: "2026-08-13T12:03:00.000Z" },
      { id: "g5", authorId: "u-ada", timestamp: "2026-08-13T12:04:00.000Z" },
    ];
    expect(findFirstUnreadGroup(withMine, MARK, "u-me")).toBe("g5");
  });

  it("never opens on a server notice", () => {
    const notices: UnreadGroup[] = [
      {
        id: "g1",
        authorId: "system",
        timestamp: "2026-08-13T12:01:00.000Z",
        system: true,
      },
      { id: "g2", authorId: "u-ada", timestamp: "2026-08-13T12:02:00.000Z" },
    ];
    expect(findFirstUnreadGroup(notices, MARK, "u-me")).toBe("g2");
  });
});
