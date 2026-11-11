import { describe, expect, it } from "vitest";

import { axisTop, CHART_ROWS, litCells } from "@/lib/chart-scale";

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

describe("litCells", () => {
  it("lights nothing for zero and at least one cell for any count", () => {
    expect(litCells(0, 100)).toBe(0);
    expect(litCells(1, 100)).toBe(1);
  });

  it("fills the column at the axis top and half of it at half", () => {
    expect(litCells(100, 100)).toBe(CHART_ROWS);
    expect(litCells(50, 100)).toBe(CHART_ROWS / 2);
  });
});
