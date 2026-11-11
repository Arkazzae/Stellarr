import type { CockpitRuntimeSample } from "@/lib/api";

export interface SparkPoint {
  /** When the bucket ends, as milliseconds. */
  end: number;
  /** Null when no sample fell in the bucket. */
  value: number | null;
}

/**
 * The last hour in `buckets` equal parts ending at the last sample, each the
 * samples' `pick` combined by `combine`: a sum for counts, the last value for
 * a level. Fewer, wider bars than samples, so a small tile stays readable.
 */
export function bucketize(
  history: readonly CockpitRuntimeSample[],
  pick: (sample: CockpitRuntimeSample) => number,
  combine: "sum" | "last",
  buckets = 30,
  windowMs = 60 * 60 * 1000,
): SparkPoint[] {
  const last = history.at(-1);
  const end = last ? Date.parse(last.at) : Date.now();
  const width = windowMs / buckets;
  const values: (number | null)[] = Array.from({ length: buckets }, () => null);
  for (const sample of history) {
    const index = buckets - 1 - Math.floor((end - Date.parse(sample.at)) / width);
    if (index < 0 || index >= buckets) continue;
    const value = pick(sample);
    values[index] = combine === "sum" ? (values[index] ?? 0) + value : value;
  }
  return values.map((value, index) => ({ end: end - (buckets - 1 - index) * width, value }));
}
