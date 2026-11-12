/** Days in the period a tile compares, and in the one before it. */
export const WEEK = 7;

/**
 * How the last week's total compares with the week before it, as a percentage
 * change: 25 for a quarter more, -10 for a tenth less. Null when there are not
 * two whole weeks of values or the earlier week is empty, so nothing is
 * compared against zero.
 */
export function weekOverWeek(values: readonly number[]): number | null {
  if (values.length < WEEK * 2) return null;
  const sum = (part: readonly number[]) => part.reduce((total, value) => total + value, 0);
  const last = sum(values.slice(-WEEK));
  const before = sum(values.slice(-WEEK * 2, -WEEK));
  if (before === 0) return null;
  return ((last - before) / before) * 100;
}
