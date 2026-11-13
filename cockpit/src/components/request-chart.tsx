import { cx } from "@stellarr/ui";
import { useState, type KeyboardEvent } from "react";

import { formatNumber } from "@/i18n/format";
import { axisTop } from "@/lib/chart-scale";

export interface RequestPoint {
  /** ISO timestamp of the end of the interval. */
  at: string;
  /** Responses that were not server errors. */
  ok: number;
  serverErrors: number;
}

interface RequestChartProps {
  points: readonly RequestPoint[];
  /** Slots on the axis; missing history at the start stays empty. */
  slots: number;
  label: string;
  okLabel: string;
  errorLabel: string;
  formatTime: (at: string) => string;
  tableCaption: string;
  timeHeading: string;
  height?: number;
}

/**
 * Responses per interval as stacked capsules: the ones that went well in the
 * series colour and server errors above them in the error colour, split by a
 * small gap. The latest interval sits at the right edge.
 */
export function RequestChart({
  points,
  slots,
  label,
  okLabel,
  errorLabel,
  formatTime,
  tableCaption,
  timeHeading,
  height = 140,
}: RequestChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const shown = points.slice(-slots);
  const padding = slots - shown.length;
  const top = axisTop(Math.max(0, ...shown.map((point) => point.ok + point.serverErrors)));
  const ticks = [...new Set([top, top / 2, 0])].filter(Number.isInteger);
  const last = shown.length - 1;
  const current = active === null ? null : shown[active];

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

  const left = (index: number) => `${((padding + index + 0.5) / slots) * 100}%`;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-chart-1" />
          {okLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-chart-2" />
          {errorLabel}
        </span>
      </div>
      <div className="flex gap-3">
        <div
          className="flex shrink-0 flex-col justify-between text-right text-xs text-muted-foreground tabular-nums"
          style={{ height }}
          aria-hidden="true"
        >
          {ticks.map((tick) => (
            <span key={tick} className="leading-none">
              {formatNumber(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            role="img"
            aria-label={label}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={() => setActive((value) => value ?? (last >= 0 ? last : null))}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="grid items-end gap-x-px rounded-sm border-b border-dotted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ height, gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: padding }, (_, index) => (
              <span key={`empty-${index}`} />
            ))}
            {shown.map((point, index) => {
              const okHeight = (point.ok / top) * 100;
              const errorHeight = (point.serverErrors / top) * 100;
              return (
                <div
                  key={point.at}
                  onPointerEnter={() => setActive(index)}
                  className="flex h-full flex-col-reverse items-center gap-0.5"
                >
                  {point.ok > 0 ? (
                    <span
                      className={cx(
                        "w-full max-w-1.5 rounded-full bg-chart-1 transition-opacity",
                        active !== null && active !== index && "opacity-55",
                      )}
                      style={{ height: `${okHeight}%` }}
                    />
                  ) : null}
                  {point.serverErrors > 0 ? (
                    <span
                      className={cx(
                        "w-full max-w-1.5 rounded-full bg-chart-2 transition-opacity",
                        active !== null && active !== index && "opacity-55",
                      )}
                      style={{ height: `${errorHeight}%` }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          {current && active !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md"
              style={{
                left: left(active),
                transform: `translate(${padding + active < slots / 6 ? "-10%" : padding + active > (slots * 5) / 6 ? "-90%" : "-50%"}, -100%)`,
              }}
            >
              <p className="text-lg leading-none font-semibold tabular-nums">
                {formatNumber(current.ok + current.serverErrors)}
              </p>
              <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
                {label}, {formatTime(current.at)}
              </p>
              {current.serverErrors > 0 ? (
                <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
                  {errorLabel}: <span className="font-semibold text-foreground">{formatNumber(current.serverErrors)}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {shown[0] && shown[last] ? (
            <div className="mt-2 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>{padding === 0 ? formatTime(shown[0].at) : ""}</span>
              <span>{formatTime(shown[last].at)}</span>
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
              <th scope="col">{okLabel}</th>
              <th scope="col">{errorLabel}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((point) => (
              <tr key={point.at}>
                <th scope="row">{formatTime(point.at)}</th>
                <td>{formatNumber(point.ok)}</td>
                <td>{formatNumber(point.serverErrors)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
