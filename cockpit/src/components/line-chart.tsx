import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { axisTop } from "@/lib/chart-scale";

export interface LinePoint {
  /** ISO timestamp of the sample. */
  at: string;
  value: number;
}

interface LineChartProps {
  points: readonly LinePoint[];
  /** What is measured; names the chart and heads the tooltip and the table. */
  label: string;
  /** The value with its unit, as the axis, the tooltip and the table show it. */
  formatValue: (value: number) => string;
  formatTime: (at: string) => string;
  tableCaption: string;
  timeHeading: string;
  /** The span the axis covers, ending at the last sample. */
  windowMs: number;
  height?: number;
}

const WIDTH = 600;

/**
 * One series over a fixed span of time: a 2 px line over a light wash, with a
 * crosshair that snaps to the nearest sample. The latest sample sits at the
 * right edge; a short history leaves the left of the span empty. Hover or the arrow keys pick a sample; its
 * value shows in a tooltip, and every value is also in a table that assistive
 * tech reads instead.
 */
export function LineChart({
  points,
  label,
  formatValue,
  formatTime,
  tableCaption,
  timeHeading,
  windowMs,
  height = 140,
}: LineChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const top = axisTop(Math.max(0, ...points.map((point) => point.value)));
  const last = points.length - 1;
  const times = points.map((point) => Date.parse(point.at));
  const end = times[last] ?? 0;
  const start = end - windowMs;
  const x = (index: number) => Math.max(0, (((times[index] ?? end) - start) / windowMs) * WIDTH);
  const y = (value: number) => height - (value / top) * height;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const area = points.length > 0 ? `${line} L${x(last)},${height} L${x(0)},${height} Z` : "";
  const ticks = [top, top / 2, 0];
  const current = active === null ? null : points[active];

  function pick(event: PointerEvent<HTMLDivElement>) {
    const box = plot.current?.getBoundingClientRect();
    if (!box || points.length === 0) return;
    const target = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * WIDTH;
    let nearest = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(x(index) - target) < Math.abs(x(nearest) - target)) nearest = index;
    }
    setActive(nearest);
  }

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
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <figure className="m-0">
      <div className="flex gap-3">
        <div
          className="flex shrink-0 flex-col justify-between text-right text-xs text-muted-foreground tabular-nums"
          style={{ height }}
          aria-hidden="true"
        >
          {ticks.map((tick) => (
            <span key={tick} className="leading-none">
              {formatValue(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={plot}
            role="img"
            aria-label={label}
            tabIndex={0}
            onPointerMove={pick}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKeyDown}
            onFocus={() => setActive((value) => value ?? last)}
            onBlur={() => setActive(null)}
            className="relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ height }}
          >
            <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
              {ticks.map((tick) => (
                <line
                  key={tick}
                  x1={0}
                  x2={WIDTH}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path d={area} className="fill-chart-1" fillOpacity={0.1} />
              <path
                d={line}
                fill="none"
                className="stroke-chart-1"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {active !== null ? (
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={0}
                  y2={height}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            {current && active !== null ? (
              <span
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-card"
                style={{ left: `${(x(active) / WIDTH) * 100}%`, top: y(current.value) }}
              />
            ) : null}
          </div>

          {current && active !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md"
              style={{
                left: `${(x(active) / WIDTH) * 100}%`,
                transform: `translate(${x(active) < WIDTH / 6 ? "-10%" : x(active) > (WIDTH * 5) / 6 ? "-90%" : "-50%"}, -100%)`,
              }}
            >
              <p className="text-lg leading-none font-semibold tabular-nums">{formatValue(current.value)}</p>
              <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
                {label}, {formatTime(current.at)}
              </p>
            </div>
          ) : null}

          {points[last] ? (
            <div className="mt-2 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>{formatTime(new Date(start).toISOString())}</span>
              <span>{formatTime(points[last].at)}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>{tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{timeHeading}</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.at}>
                <th scope="row">{formatTime(point.at)}</th>
                <td>{formatValue(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

