import { describe, expect, it } from "vitest";

import { cx } from "@stellarr/ui";

describe("@stellarr/ui", () => {
  it("joins the truthy class names with single spaces", () => {
    expect(cx("a", false, "b", null, undefined, "c")).toBe("a b c");
  });

  it("returns an empty string when no class name is truthy", () => {
    expect(cx(false, null, undefined)).toBe("");
  });
});
