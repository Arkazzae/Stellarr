import { describe, expect, it } from "vitest";

import { place } from "./place";

const view = { width: 1000, height: 800 };
const anchor = (left: number, top: number, width = 32, height = 32) => new DOMRect(left, top, width, height);

describe("place", () => {
  it("hangs under the anchor, its end on the anchor's end", () => {
    expect(place(anchor(600, 100), { width: 150, height: 140 }, view, { side: "bottom", align: "end", offset: 4 })).toEqual({
      left: 482,
      top: 136,
      side: "bottom",
      availableHeight: 664,
    });
  });

  it("stands above when asked, as tall as it is", () => {
    const placement = place(anchor(12, 700, 240, 50), { width: 240, height: 130 }, view, {
      side: "top",
      align: "start",
      offset: 4,
    });

    expect(placement).toMatchObject({ left: 12, top: 566, side: "top" });
  });

  it("flips only when its side cannot hold it and the other has more room", () => {
    const low = anchor(100, 700);
    expect(place(low, { width: 100, height: 200 }, view, { side: "bottom", align: "start", offset: 4 }).side).toBe("top");
    expect(place(low, { width: 100, height: 60 }, view, { side: "bottom", align: "start", offset: 4 }).side).toBe("bottom");
  });

  it("slides along the anchor to stay inside the window", () => {
    expect(place(anchor(980, 100), { width: 200, height: 50 }, view, { side: "bottom", align: "start", offset: 4 }).left).toBe(800);
    expect(place(anchor(5, 100), { width: 200, height: 50 }, view, { side: "bottom", align: "end", offset: 4 }).left).toBe(0);
  });
});
