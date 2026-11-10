import { describe, expect, it } from "vitest";

import { placeAnchoredCard } from "./AnchoredCard";

describe("placeAnchoredCard", () => {
  it("clamps an oversized card inside every safe-area edge", () => {
    expect(
      placeAnchoredCard(
        { left: 10, right: 58, top: 500 },
        { width: 390, height: 600 },
        {
          width: 320,
          height: 568,
          offsetLeft: 0,
          offsetTop: 0,
          insetTop: 47,
          insetRight: 20,
          insetBottom: 34,
          insetLeft: 44,
        },
      ),
    ).toEqual({
      left: 44,
      top: 47,
      maxWidth: 256,
      maxHeight: 487,
    });
  });

  it("uses visual-viewport offsets while the page is zoomed or panned", () => {
    expect(
      placeAnchoredCard(
        { left: 430, right: 474, top: 320 },
        { width: 200, height: 100 },
        {
          width: 360,
          height: 300,
          offsetLeft: 100,
          offsetTop: 50,
          insetTop: 0,
          insetRight: 0,
          insetBottom: 0,
          insetLeft: 0,
        },
      ),
    ).toEqual({
      left: 222,
      top: 238,
      maxWidth: 336,
      maxHeight: 276,
    });
  });

  it("opens beside the anchor when there is room", () => {
    expect(
      placeAnchoredCard(
        { left: 20, right: 64, top: 100 },
        { width: 320, height: 200 },
        {
          width: 640,
          height: 360,
          offsetLeft: 0,
          offsetTop: 0,
          insetTop: 0,
          insetRight: 0,
          insetBottom: 0,
          insetLeft: 0,
        },
      ),
    ).toEqual({
      left: 72,
      top: 100,
      maxWidth: 616,
      maxHeight: 336,
    });
  });
});
