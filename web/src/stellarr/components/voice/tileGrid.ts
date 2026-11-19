/** How many tiles go across the stage and how many rows that makes. */
export interface TileGrid {
  cols: number;
  rows: number;
}

/**
 * The column count that gives the largest tile for `count` people in a box of
 * `width` by `height`, with `gap` between tiles and tiles of `ratio` (width
 * over height).
 *
 * Every count from one column to one row is tried; a tile is as wide as the
 * narrower of what the columns leave it and what the rows leave it. A tie, to
 * half a pixel, goes to fewer columns.
 */
export function bestGrid(
  count: number,
  width: number,
  height: number,
  gap: number,
  ratio: number,
): TileGrid {
  if (count < 1) return { cols: 1, rows: 1 };
  // A box with no size yet, such as a stage hidden behind cinema: nothing to
  // compare, so one column, which is what the stylesheet assumes too.
  if (width <= 0 || height <= 0) return { cols: 1, rows: count };

  let best: TileGrid = { cols: 1, rows: count };
  let bestWidth = -Infinity;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const tileWidth = Math.min(
      (width - (cols - 1) * gap) / cols,
      ((height - (rows - 1) * gap) / rows) * ratio,
    );
    if (tileWidth > bestWidth + 0.5) {
      best = { cols, rows };
      bestWidth = tileWidth;
    }
  }
  return best;
}
