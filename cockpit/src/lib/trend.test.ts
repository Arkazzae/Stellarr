import { describe, expect, it } from "vitest";

import { weekOverWeek } from "./trend";

const days = (before: number[], last: number[]) => [...before, ...last];

describe("weekOverWeek", () => {
  it("compares the last seven days with the seven before", () => {
    expect(weekOverWeek(days([10, 10, 10, 10, 10, 10, 20], [20, 20, 10, 20, 20, 20, 15]))).toBeCloseTo(56.25);
    expect(weekOverWeek(days([10, 10, 10, 10, 10, 10, 10], [5, 5, 5, 5, 5, 5, 5]))).toBe(-50);
  });

  it("looks only at the last two weeks of a longer window", () => {
    const older = Array.from({ length: 16 }, () => 1000);
    expect(weekOverWeek([...older, ...days([1, 1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2, 2])])).toBe(100);
  });

  it("compares nothing against an empty week or a short window", () => {
    expect(weekOverWeek(days([0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(weekOverWeek([1, 2, 3])).toBeNull();
  });
});
