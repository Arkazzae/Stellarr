/** Cells in a full column of the activity chart. */
export const CHART_ROWS = 14;
/**
 * The gap between cells and the least height of the plot (14 cells of 6 px and
 * their gaps), in px at the default font size. Drawn in rem through `rem()`,
 * so the chart follows the panel's scale. Cells share whatever height the
 * chart is given.
 */
export const CHART_GAP = 3;
export const CHART_MIN_HEIGHT = CHART_ROWS * 6 + (CHART_ROWS - 1) * CHART_GAP;

/** A size in px at the default font size, as rem. */
export const rem = (px: number) => `${px / 16}rem`;

/** The axis top: the smallest clean number at or above the largest value. */
export function axisTop(max: number): number {
  if (max <= 5) return Math.max(max, 1);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= max) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Lit cells for a value against the axis top; anything above zero lights at least one. */
export function litCells(value: number, top: number): number {
  return value <= 0 ? 0 : Math.max(1, Math.round((value / top) * CHART_ROWS));
}
