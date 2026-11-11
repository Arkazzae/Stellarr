import { useState, type KeyboardEvent } from "react";

import { formatDay, formatNumber } from "@/i18n/format";
import { axisTop, CHART_GAP, CHART_MIN_HEIGHT, CHART_ROWS, litCells } from "@/lib/chart-scale";
import { cn } from "@/lib/utils";

export interface ActivityPoint {
  /** The instance's local date, YYYY-MM-DD. */
  date: string;
  value: number;
}

/** Where a label centred on column `index` of `count` sits, kept inside the plot at both ends. */
function placement(index: number, count: number) {
  const left = `${((index + 0.5) / count) * 100}%`;
  if (index < 2) return { left, transform: "translateX(-25%)" };
  if (index > count - 3) return { left, transform: "translateX(-75%)" };
  return { left, transform: "translateX(-50%)" };
}

const shortDay: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const longDay: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "long" };

interface ActivityChartProps {
  points: readonly ActivityPoint[];
  /** What is counted; names the chart for assistive tech and heads the tooltip and table. */
  label: string;
  /** The table view's caption and its date column. */
  tableCaption: string;
  dateHeading: string;
}

/**
 * Daily counts as columns of cells, a nod to the speaking meter in the logo.
 * Hover or the arrow keys pick a day; its exact value shows in a tooltip, and
 * every value is also in a table that assistive tech reads instead. The plot
 * fills the height its container gives it, down to CHART_MIN_HEIGHT.
 */
export function ActivityChart({ points, label, tableCaption, dateHeading }: ActivityChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const top = axisTop(Math.max(0, ...points.map((point) => point.value)));
  const ticks = [...new Set([top, top / 2, 0])].filter(Number.isInteger);
  const labelled = [0, 7, 14, 21, points.length - 1];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, (active ?? last) - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, (active ?? last) + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  const current = active === null ? null : points[active];

  return (
    <figure className="m-0 flex flex-1 flex-col">
      <div className="grid flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-3">
        <div
          className="flex flex-col justify-between text-right text-xs text-muted-foreground tabular-nums"
          style={{ minHeight: CHART_MIN_HEIGHT }}
          aria-hidden="true"
        >
          {ticks.map((tick) => (
            <span key={tick} className="leading-none">
              {formatNumber(tick)}
            </span>
          ))}
        </div>

        <div className="relative" style={{ minHeight: CHART_MIN_HEIGHT }}>
          <div
            role="img"
            aria-label={label}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={() => setActive((value) => value ?? points.length - 1)}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="grid h-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              columnGap: CHART_GAP,
              gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
            }}
          >
            {points.map((point, index) => {
              const lit = litCells(point.value, top);
              return (
                <div
                  key={point.date}
                  onPointerEnter={() => setActive(index)}
                  className="flex h-full flex-col-reverse items-center"
                  style={{ gap: CHART_GAP }}
                >
                  {Array.from({ length: CHART_ROWS }, (_, row) => (
                    <span
                      key={row}
                      className={cn(
                        "min-h-0 w-full max-w-4 flex-1 rounded-[2px] transition-opacity",
                        row < lit ? "bg-chart-1" : "bg-chart-track",
                        active !== null && active !== index && row < lit && "opacity-55",
                      )}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {current && active !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md"
              style={placement(active, points.length)}
            >
              <p className="text-lg leading-none font-semibold tabular-nums">{formatNumber(current.value)}</p>
              <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
                {label}, {formatDay(current.date, longDay)}
              </p>
            </div>
          ) : null}
        </div>

        <div className="relative col-start-2 mt-2 h-4 text-xs text-muted-foreground" aria-hidden="true">
          {labelled.map((index) =>
            points[index] ? (
              <span key={index} className="absolute whitespace-nowrap" style={placement(index, points.length)}>
                {formatDay(points[index].date, shortDay)}
              </span>
            ) : null,
          )}
        </div>
      </div>

      {/* A table ignores the clipping of sr-only, so a block around it carries the class. */}
      <div className="sr-only">
        <table>
          <caption>{tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{dateHeading}</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{formatDay(point.date, longDay)}</th>
                <td>{formatNumber(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
