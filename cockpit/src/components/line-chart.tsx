import { useId, useState, type KeyboardEvent } from "react";

import { formatNumber } from "@/i18n/format";
import { axisTop, rem } from "@/lib/chart-scale";

export interface LinePoint {
  /** Unique within the chart: the date or the time of the point. */
  key: string;
  value: number;
}

interface LineChartProps {
  points: readonly LinePoint[];
  /** Places on the axis; points fill the last ones, so missing history at the start stays empty. */
  slots?: number;
  /** What is counted; names the plot for assistive tech and heads the table's value column. */
  label: string;
  /** The picked point's note under its value, such as "Messages, Tue 11 November". */
  describe: (point: LinePoint) => string;
  /** A point's row heading in the table view. */
  rowHeading: (point: LinePoint) => string;
  tableCaption: string;
  keyHeading: string;
  /** Points labelled under the plot, each with a dotted line up through it. */
  ticks?: readonly { index: number; text: string }[];
  /**
   * How the point in view is lit: a column of light under it, or a thin line
   * through the whole plot. The highest point is in view until another is picked.
   */
  highlight?: "band" | "spike";
  /** A soft wash of the accent under the line. */
  area?: boolean;
  /** The plot's least height in px at the default font size; it grows into the height it is given. */
  minHeight?: number;
}

/** The share of the plot's height, in percent, kept free above the highest point for its label. */
const HEADROOM = 18;

/** Where a label centred on slot `index` of `count` sits, kept inside the plot at both ends. */
function placement(index: number, count: number) {
  const left = `${((index + 0.5) / count) * 100}%`;
  if (index < count / 8) return { left, transform: "translateX(-15%)" };
  if (index > (count * 7) / 8) return { left, transform: "translateX(-85%)" };
  return { left, transform: "translateX(-50%)" };
}

/**
 * Counts as a thin line in the accent. The highest point is lit and carries its
 * value; hover or the arrow keys pick another, whose exact value shows in a
 * note. Every value is also in a table that assistive tech reads instead. The
 * plot fills the height it is given.
 */
export function LineChart({
  points,
  slots = points.length,
  label,
  describe,
  rowHeading,
  tableCaption,
  keyHeading,
  ticks = [],
  highlight = "band",
  area = false,
  minHeight = 96,
}: LineChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const gradient = `line-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const shown = points.slice(-slots);
  const padding = slots - shown.length;
  const last = shown.length - 1;
  const max = Math.max(0, ...shown.map((point) => point.value));
  const top = axisTop(max);

  const x = (index: number) => padding + index + 0.5;
  const y = (value: number) => 100 - (value / top) * (100 - HEADROOM);
  const line = shown.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
  const wash = last >= 0 ? `M${x(0)},100 ${line.replace(/^M/, "L")} L${x(last)},100 Z` : "";
  const peak = max > 0 ? shown.findIndex((point) => point.value === max) : -1;
  const lit = active ?? (peak >= 0 ? peak : null);
  const litPoint = lit === null ? null : shown[lit];
  const current = active === null ? null : shown[active];
  const at = (index: number) => `${((padding + index + 0.5) / slots) * 100}%`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = active ?? last;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, from - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, from + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null || last < 0) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <figure className="m-0 flex flex-1 flex-col">
      <div className="relative flex-1" style={{ minHeight: rem(minHeight) }}>
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <span className="absolute inset-x-0 bottom-0 border-t border-dotted border-border" />
          {ticks.map(({ index }) => (
            <span
              key={index}
              className="absolute inset-y-0 border-l border-dotted border-border"
              style={{ left: at(index) }}
            />
          ))}
        </div>

        {litPoint && lit !== null ? (
          highlight === "band" ? (
            <span
              className="pointer-events-none absolute bottom-0 w-5 -translate-x-1/2 rounded-t-full band-chart"
              style={{ left: at(lit), top: `${y(litPoint.value)}%` }}
              aria-hidden="true"
            />
          ) : (
            <span
              className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-chart-1/70"
              style={{ left: at(lit) }}
              aria-hidden="true"
            />
          )
        ) : null}

        <svg
          viewBox={`0 0 ${slots} 100`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
          focusable="false"
        >
          {area && wash ? (
            <>
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.22 }} />
                  <stop offset="1" style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <path d={wash} fill={`url(#${gradient})`} />
            </>
          ) : null}
          <path
            d={line}
            fill="none"
            className="stroke-chart-1"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: "0.09375rem" }}
          />
        </svg>

        {litPoint && lit !== null ? (
          <span
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-card marker-glow"
            style={{ left: at(lit), top: `${y(litPoint.value)}%` }}
            aria-hidden="true"
          />
        ) : null}

        {/* The highest point keeps its value above it while nothing else is picked. */}
        {peak >= 0 && active === null ? (
          <span
            className="pointer-events-none absolute -translate-y-full pb-2.5 text-xs font-medium whitespace-nowrap text-foreground tabular-nums"
            style={{ top: `${y(max)}%`, ...placement(padding + peak, slots) }}
            aria-hidden="true"
          >
            {formatNumber(max)}
          </span>
        ) : null}

        <div
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((value) => value ?? (last >= 0 ? last : null))}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          className="absolute inset-0 grid rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: padding }, (_, index) => (
            <span key={`empty-${index}`} />
          ))}
          {shown.map((point, index) => (
            <span key={point.key} onPointerEnter={() => setActive(index)} />
          ))}
        </div>

        {current && active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-y-full rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md"
            style={{ top: `calc(${y(current.value)}% - 0.75rem)`, ...placement(padding + active, slots) }}
          >
            <p className="text-lg leading-none font-semibold tabular-nums">{formatNumber(current.value)}</p>
            <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">{describe(current)}</p>
          </div>
        ) : null}
      </div>

      {ticks.length ? (
        <div className="relative mt-2.5 h-5 text-sm text-muted-foreground" aria-hidden="true">
          {ticks.map(({ index, text }) => (
            <span key={index} className="absolute whitespace-nowrap" style={placement(padding + index, slots)}>
              {text}
            </span>
          ))}
        </div>
      ) : null}

      {/* A table ignores the clipping of sr-only, so a block around it carries the class. */}
      <div className="sr-only">
        <table>
          <caption>{tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{keyHeading}</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((point) => (
              <tr key={point.key}>
                <th scope="row">{rowHeading(point)}</th>
                <td>{formatNumber(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
