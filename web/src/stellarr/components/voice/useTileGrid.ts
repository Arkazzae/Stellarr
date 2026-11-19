import { useLayoutEffect, useRef } from "react";

import { bestGrid } from "./tileGrid";

/** Narrower than this, the stage is a portrait column and its tiles are square. */
const SQUARE_BELOW_PX = 600;
const WIDE = 16 / 9;

/**
 * Lays out the stage's tiles. It measures the box that holds them and
 * publishes on it, as custom properties, the columns, the rows and the tile
 * shape that give the largest tile for `count` people. `voice.css` sizes every
 * tile from those three; nothing here sizes a tile itself.
 */
export function useTileGrid(count: number) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) return;

    const publish = (width: number, height: number) => {
      const ratio = width < SQUARE_BELOW_PX ? 1 : WIDE;
      // The gap is the stylesheet's, so the two cannot disagree.
      const gap = Number.parseFloat(getComputedStyle(box).columnGap) || 0;
      const { cols, rows } = bestGrid(count, width, height, gap, ratio);
      box.style.setProperty("--cols", String(cols));
      box.style.setProperty("--rows", String(rows));
      box.style.setProperty("--tile-ratio", String(ratio));
    };

    // Now, so someone who joins is placed before the frame is painted, and
    // again whenever the room around the stage changes size.
    publish(box.clientWidth, box.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) publish(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [count]);

  return ref;
}
