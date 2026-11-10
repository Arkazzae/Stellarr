import { describe, expect, it } from "vitest";

import { at, message } from "@/test/messages";

import { applyPinChanges, applyPinEcho, sortPins } from "./pins";

const pinned = (id: string, pinMinute: number) =>
  message(id, 1, { pinnedAt: at(pinMinute) });
const ids = (messages: readonly { id: string }[]) => messages.map((m) => m.id);

describe("sortPins", () => {
  it("puts the newest pin first and leaves the input alone", () => {
    const input = [pinned("a", 1), pinned("b", 3), pinned("c", 2)];
    expect(ids(sortPins(input))).toEqual(["b", "c", "a"]);
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});

describe("applyPinEcho", () => {
  it("adds a message that has just been pinned, at the top", () => {
    const next = applyPinEcho([pinned("a", 1)], pinned("b", 5));
    expect(ids(next)).toEqual(["b", "a"]);
  });

  it("removes a message that was unpinned", () => {
    const next = applyPinEcho([pinned("a", 1), pinned("b", 2)], message("b", 1));
    expect(ids(next)).toEqual(["a"]);
  });

  it("returns the same list for an echo that changes nothing", () => {
    const pins = [pinned("a", 1)];
    expect(applyPinEcho(pins, message("unrelated", 1))).toBe(pins);
    expect(applyPinEcho(pins, pins[0]!)).toBe(pins);
  });

  it("takes the edited copy of a message that stays pinned", () => {
    const edited = { ...pinned("a", 1), content: "edited" };
    expect(applyPinEcho([pinned("a", 1)], edited)[0]?.content).toBe("edited");
  });
});

describe("applyPinChanges", () => {
  it("replays pins, unpins and deletions in order", () => {
    const next = applyPinChanges([pinned("a", 1), pinned("b", 2)], [
      { cursor: "1", kind: "upsert", messageId: "c", message: pinned("c", 9) },
      { cursor: "2", kind: "upsert", messageId: "a", message: message("a", 1) },
      { cursor: "3", kind: "delete", messageId: "b" },
    ]);
    expect(ids(next)).toEqual(["c"]);
  });
});
