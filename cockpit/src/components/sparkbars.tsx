import { getLocale } from "@/i18n";
import type { SparkPoint } from "@/lib/sparkline";
import { cn } from "@/lib/utils";

interface SparkbarsProps {
  points: readonly SparkPoint[];
  /** The value as a tile would write it, for the hover note of each bar. */
  format: (value: number) => string;
  /** Server errors are red, as in the request chart; everything else is the accent. */
  tone?: "accent" | "danger";
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(getLocale() === "pl" ? "pl-PL" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * A tile's last hour as small bars from a shared baseline. The tile states the
 * figure in text, so the bars are decoration for assistive tech; hovering one
 * names its time and value.
 */
export function Sparkbars({ points, format, tone = "accent" }: SparkbarsProps) {
  const top = Math.max(0, ...points.map((point) => point.value ?? 0));
  return (
    <div className="flex h-7 items-end gap-[2px]" aria-hidden="true">
      {points.map((point) => {
        const empty = point.value === null || point.value === 0 || top === 0;
        const share = empty ? 0 : (point.value as number) / top;
        return (
          <span
            key={point.end}
            title={point.value === null ? clock(point.end) : `${clock(point.end)}: ${format(point.value)}`}
            className={cn(
              "min-w-0 flex-1 rounded-t-[2px]",
              empty ? "bg-chart-track" : tone === "danger" ? "bg-chart-2" : "bg-chart-1",
            )}
            style={{ height: empty ? "2px" : `${Math.max(8, share * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
