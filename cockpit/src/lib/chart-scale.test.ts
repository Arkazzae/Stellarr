import { describe, expect, it } from "vitest";

import { axisTop } from "@/lib/chart-scale";

describe("axisTop", () => {
  it.each([
    [0, 1],
    [1, 1],
    [5, 5],
    [6, 10],
    [12, 20],
    [21, 25],
    [26, 50],
    [100, 100],
    [101, 200],
    [2400, 2500],
  ])("puts the top of an axis whose largest value is %d at %d", (max, top) => {
    expect(axisTop(max)).toBe(top);
  });
});
