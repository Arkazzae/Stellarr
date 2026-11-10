import { describe, expect, it } from "vitest";

import { advanceHistoryWindow, initialHistoryWindow } from "./historyWindow";
import type { Row } from "./transcriptRows";

const day = (name: string): Row => ({ kind: "day", id: `day-${name}`, day: name });
const unread = (id: string): Row => ({ kind: "unread", id: `unread-${id}` });
const block = (id: string): Row => ({
  kind: "group",
  id,
  group: {
    id,
    authorId: "u1",
    authorName: "Ada",
    timestamp: "2026-08-14T10:00:00Z",
    bodies: [{ id, parts: [] }],
  },
});

describe("advanceHistoryWindow", () => {
  const before = initialHistoryWindow([day("d"), block("b"), block("c")]);

  it("keeps the same window while the rows are the same", () => {
    expect(
      advanceHistoryWindow(before, [day("d"), block("b"), block("c")], 1_000_001),
    ).toBe(before);
  });

  it("lowers the first index by the rows prepended above the visible message", () => {
    const next = advanceHistoryWindow(
      before,
      [day("d"), block("a1"), block("a2"), block("b"), block("c")],
      1_000_001,
    );
    expect(next.firstItemIndex).toBe(1_000_000 - 2);
  });

  it("leaves the index alone when rows are only appended", () => {
    const next = advanceHistoryWindow(
      before,
      [day("d"), block("b"), block("c"), block("d")],
      1_000_001,
    );
    expect(next.firstItemIndex).toBe(1_000_000);
    expect(next.rows).toHaveLength(4);
  });

  it("never anchors on a separator that stayed put while messages arrived above it", () => {
    // The day separator keeps index 0, but the message under it moved by one.
    const next = advanceHistoryWindow(before, [day("d"), block("a"), block("b"), block("c")], 1_000_000);
    expect(next.firstItemIndex).toBe(1_000_000 - 1);
  });

  it("looks further down for an anchor when the visible block disappeared", () => {
    // `b` merged into a new block; `c` is the nearest survivor below it.
    const next = advanceHistoryWindow(
      before,
      [day("d"), block("a"), block("ab"), block("c")],
      1_000_001,
    );
    expect(next.firstItemIndex).toBe(1_000_000 - 1);
  });

  it("falls back to an anchor above when nothing below survives", () => {
    const window = initialHistoryWindow([day("d"), block("b"), block("c")]);
    const next = advanceHistoryWindow(window, [day("d"), block("a"), block("b")], 1_000_002);
    expect(next.firstItemIndex).toBe(1_000_000 - 1);
  });

  it("anchors on the newest block when the visible range is unknown", () => {
    const next = advanceHistoryWindow(
      before,
      [day("d"), block("a"), block("b"), block("c")],
      null,
    );
    expect(next.firstItemIndex).toBe(1_000_000 - 1);
  });

  it("ignores an unread line that appears or goes away", () => {
    const next = advanceHistoryWindow(
      before,
      [day("d"), unread("b"), block("b"), block("c")],
      1_000_001,
    );
    expect(next.firstItemIndex).toBe(1_000_000 - 1);
  });

  it("keeps the index when no message survives to anchor on", () => {
    const next = advanceHistoryWindow(before, [day("d"), block("x"), block("y")], 1_000_001);
    expect(next.firstItemIndex).toBe(1_000_000);
    expect(next.rows.map((row) => row.id)).toEqual(["day-d", "x", "y"]);
  });
});
