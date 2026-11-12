import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
  it.each([
    ["/", "/"],
    ["/cockpit/", "/cockpit/"],
    ["/invite/abc?x=1#y", "/invite/abc?x=1#y"],
    ["%2Fcockpit%2F", null],
  ])("keeps a path on this origin: %s", (raw, expected) => {
    expect(safeReturnPath(raw)).toBe(expected);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "%2F%2Fevil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/\t/evil.example",
    "cockpit",
    "",
  ])("refuses anything that could leave the origin: %s", (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });
});
