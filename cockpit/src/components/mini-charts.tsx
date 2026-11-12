import { useId } from "react";

import { useMeasuredBox } from "@/lib/use-measured-box";
import { cn } from "@/lib/utils";

/**
 * Small charts for the overview's tiles. The tile states its figure in text, so
 * each chart is decoration for assistive tech; hovering a mark names its day
 * and value. They fill the box their parent gives them. Dots and arcs are drawn
 * in real pixels from the measured box, their sizes given in px at the default
 * font size and multiplied by the panel's scale.
 */

export interface MiniPoint {
  /** Unique within the chart, such as the date. */
  key: string;
  value: number;
  /** The mark's hover note: when, and how many. */
  note: string;
}

/** An id that is safe inside url(#…): React's ids carry colons. */
function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Hover strips over a chart, one per point, so a note shows wherever the pointer is. */
function HoverStrips({ points }: { points: readonly { key: string; note: string }[] }) {
  return (
    <div className="absolute inset-0 flex">
      {points.map((point) => (
        <span key={point.key} title={point.note} className="h-full min-w-0 flex-1" />
      ))}
    </div>
  );
}

/** The x of point `index` of `count` across `width`, the first and last half a step in from the edges. */
const spread = (index: number, count: number, width: number) => ((index + 0.5) / count) * width;

/**
 * A dotted line over a dotted grid, brightest at its highest point, which
 * carries a lit marker.
 */
export function MiniLine({ points }: { points: readonly MiniPoint[] }) {
  const [ref, { width, height, scale }] = useMeasuredBox<HTMLDivElement>();
  const fade = useSvgId("mini-line");
  const count = points.length;
  const top = Math.max(0, ...points.map((point) => point.value));
  const peak = points.findIndex((point) => point.value === top);
  const room = 6 * scale;
  const x = (index: number) => spread(index, count, width);
  const y = (value: number) => height - room - (top > 0 ? value / top : 0) * (height - room * 2);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");

  return (
    <div ref={ref} className="relative h-full" aria-hidden="true">
      {width > 0 && count > 0 ? (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" focusable="false">
          <defs>
            <linearGradient id={fade} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2="0">
              <stop offset="0" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.3 }} />
              <stop offset={x(peak) / width} style={{ stopColor: "var(--chart-1)", stopOpacity: 1 }} />
              <stop offset="1" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.3 }} />
            </linearGradient>
          </defs>
          {points.map((point, index) => (
            <line
              key={point.key}
              x1={x(index)}
              x2={x(index)}
              y1={0}
              y2={height}
              className="stroke-border"
              strokeLinecap="round"
              style={{ strokeWidth: scale, strokeDasharray: `0 ${3 * scale}` }}
            />
          ))}
          <path
            d={line}
            fill="none"
            stroke={`url(#${fade})`}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ strokeWidth: 2.5 * scale, strokeDasharray: `0 ${4.5 * scale}` }}
          />
          {top > 0 ? (
            <>
              <circle cx={x(peak)} cy={y(top)} r={9 * scale} className="fill-chart-1" opacity={0.22} />
              <circle
                cx={x(peak)}
                cy={y(top)}
                r={4 * scale}
                className="fill-chart-1 stroke-card"
                style={{ strokeWidth: 2 * scale }}
              />
            </>
          ) : null}
        </svg>
      ) : null}
      <HoverStrips points={points} />
    </div>
  );
}

/** Dotted stems with a dot on each; the latest stands out in the text colour, the rest recede. */
export function MiniStems({ points }: { points: readonly MiniPoint[] }) {
  const [ref, { width, height, scale }] = useMeasuredBox<HTMLDivElement>();
  const count = points.length;
  const top = Math.max(0, ...points.map((point) => point.value));
  const room = 5 * scale;
  const x = (index: number) => spread(index, count, width);
  const y = (value: number) => height - (top > 0 ? value / top : 0) * (height - room);

  return (
    <div ref={ref} className="relative h-full" aria-hidden="true">
      {width > 0 ? (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" focusable="false">
          {points.map((point, index) => {
            const latest = index === count - 1;
            const tone = latest ? "fill-foreground stroke-foreground" : "fill-faint stroke-faint";
            return (
              <g key={point.key} className={tone}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={height}
                  y2={y(point.value)}
                  strokeLinecap="round"
                  style={{ strokeWidth: (latest ? 1.75 : 1.25) * scale, strokeDasharray: `0 ${3 * scale}` }}
                />
                <circle cx={x(index)} cy={y(point.value)} r={(latest ? 3.5 : 2.25) * scale} stroke="none" />
              </g>
            );
          })}
        </svg>
      ) : null}
      <HoverStrips points={points} />
    </div>
  );
}

/** Rows of cells in a full column. */
const CELL_ROWS = 8;

/**
 * Columns of cells lit from the bottom, a nod to the speaking meter in the
 * logo: the last `recent` days in the accent, the ones before a step quieter,
 * the unlit cells a faint wash of it. Any count above zero lights a cell.
 */
export function MiniCells({
  points,
  recent,
  tone = "accent",
}: {
  points: readonly MiniPoint[];
  recent: number;
  /** Server errors are red, as in the request chart; everything else is the accent. */
  tone?: "accent" | "danger";
}) {
  const top = Math.max(0, ...points.map((point) => point.value));
  const shades =
    tone === "danger"
      ? { unlit: "bg-chart-2/12", recent: "bg-chart-2", before: "bg-chart-2/55" }
      : { unlit: "bg-chart-1/12", recent: "bg-chart-1", before: "bg-chart-1/55" };
  return (
    <div className="flex h-full gap-0.5" aria-hidden="true">
      {points.map((point, index) => {
        const lit = point.value <= 0 || top === 0 ? 0 : Math.max(1, Math.round((point.value / top) * CELL_ROWS));
        const isRecent = index >= points.length - recent;
        return (
          <span key={point.key} title={point.note} className="flex min-w-0 flex-1 flex-col-reverse gap-0.5">
            {Array.from({ length: CELL_ROWS }, (_, row) => (
              <span
                key={row}
                className={cn(
                  "min-h-0 flex-1 rounded-xs",
                  row >= lit ? shades.unlit : isRecent ? shades.recent : shades.before,
                )}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A share of a whole on an arc across the box's width: a dotted track, the
 * share drawn solid from the left and a lit marker where it ends. The arc is
 * the part of a circle through both bottom corners and the top middle, so a
 * wide, low box gets a flat arc and a square one a half circle.
 */
export function ArcGauge({ part, whole, note }: { part: number; whole: number; note: string }) {
  const [ref, { width, height, scale }] = useMeasuredBox<HTMLDivElement>();
  const share = whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;
  const room = 6 * scale;
  const half = width / 2 - room;
  const rise = Math.min(half, height - room * 2);
  const radius = rise > 0 ? (half * half + rise * rise) / (2 * rise) : 0;
  const centre = { x: width / 2, y: room + radius };
  /** Half the angle the arc spans, either side of straight up. */
  const spread = radius > 0 ? Math.asin(Math.min(1, half / radius)) : 0;
  const pointAt = (fraction: number) => {
    const angle = -Math.PI / 2 - spread + 2 * spread * fraction;
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  };
  const start = pointAt(0);
  const end = pointAt(share);
  const finish = pointAt(1);
  const track = `M${start.x},${start.y} A${radius},${radius} 0 0 1 ${finish.x},${finish.y}`;
  const filled = `M${start.x},${start.y} A${radius},${radius} 0 0 1 ${end.x},${end.y}`;

  return (
    <div ref={ref} className="relative h-full" title={note} aria-hidden="true">
      {radius > 0 ? (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" focusable="false">
          <path
            d={track}
            fill="none"
            className="stroke-faint"
            strokeLinecap="round"
            style={{ strokeWidth: 1.5 * scale, strokeDasharray: `0 ${4 * scale}` }}
          />
          {share > 0 ? (
            <path d={filled} fill="none" className="stroke-chart-1" strokeLinecap="round" style={{ strokeWidth: 2 * scale }} />
          ) : null}
          <circle cx={start.x} cy={start.y} r={2.5 * scale} className="fill-foreground" />
          <circle cx={end.x} cy={end.y} r={10 * scale} className="fill-chart-1" opacity={0.22} />
          <circle
            cx={end.x}
            cy={end.y}
            r={4.5 * scale}
            className="fill-foreground stroke-chart-1"
            style={{ strokeWidth: 2 * scale }}
          />
        </svg>
      ) : null}
    </div>
  );
}

export interface CapsulePoint {
  key: string;
  /** Null when no sample fell in the period: the capsule is left out, its dot and label stay. */
  value: number | null;
  /** Under the capsule, such as the time the period ends. */
  label: string;
  note: string;
}

/**
 * Capsules on a dot each, their label under them, from a shared baseline; the
 * latest in the text colour and the ones before receding.
 */
export function CapsuleBars({ points }: { points: readonly CapsulePoint[] }) {
  const top = Math.max(0, ...points.map((point) => point.value ?? 0));
  const last = points.length - 1;
  return (
    <div className="flex h-full justify-between" aria-hidden="true">
      {points.map((point, index) => {
        const latest = index === last;
        const share = point.value === null || top === 0 ? 0 : point.value / top;
        return (
          <span key={point.key} title={point.note} className="flex min-w-0 flex-1 flex-col items-center">
            <span className="flex w-full min-h-0 flex-1 items-end justify-center">
              {share > 0 ? (
                <span
                  className={cn(
                    "w-2.5 rounded-full bg-linear-to-b",
                    latest ? "from-foreground to-foreground/35" : "from-muted-foreground/70 to-muted-foreground/15",
                  )}
                  style={{ height: `${Math.max(12, share * 100)}%` }}
                />
              ) : null}
            </span>
            <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", latest ? "bg-foreground" : "bg-faint")} />
            <span className="mt-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{point.label}</span>
          </span>
        );
      })}
    </div>
  );
}
