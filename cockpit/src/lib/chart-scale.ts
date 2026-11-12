/**
 * A size in px at the default font size, as rem, so a chart drawn from px
 * figures follows the panel's scale (index.css).
 */
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
