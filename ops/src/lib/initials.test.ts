import { describe, expect, it } from "vitest";

import { initialsOf } from "@/lib/initials";

describe("initialsOf", () => {
  it.each([
    ["Ola Maria Owner", "OM"],
    ["Ola", "O"],
    ["ola owner", "OO"],
    ["  Ola   Owner ", "OO"],
    ["żaneta łuk", "ŻŁ"],
    ["😀 Ola", "😀O"],
    ["", "?"],
    ["   ", "?"],
  ])("turns %j into %j", (displayName, initials) => {
    expect(initialsOf(displayName)).toBe(initials);
  });
});
