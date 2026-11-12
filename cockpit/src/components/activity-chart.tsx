import { LineChart } from "@/components/line-chart";
import { formatDay } from "@/i18n/format";

export interface ActivityPoint {
  /** The instance's local date, YYYY-MM-DD. */
  date: string;
  value: number;
}

const shortDay: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const longDay: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "long" };

/** The plot's least height in px at the default font size. */
const MIN_HEIGHT = 80;

interface ActivityChartProps {
  points: readonly ActivityPoint[];
  /** What is counted; names the chart for assistive tech and heads the tooltip and table. */
  label: string;
  /** The table view's caption and its date column. */
  tableCaption: string;
  dateHeading: string;
}

/**
 * Daily counts over the window as a line, a week between the labelled days,
 * the busiest day lit until another is picked.
 * Hover or the arrow keys pick a day; its exact value shows in a note, and
 * every value is also in a table that assistive tech reads instead.
 */
export function ActivityChart({ points, label, tableCaption, dateHeading }: ActivityChartProps) {
  const last = points.length - 1;
  const ticks = [0, 7, 14, 21, last]
    .filter((index, position, all) => index >= 0 && index <= last && all.indexOf(index) === position)
    .map((index) => ({ index, text: formatDay(points[index]!.date, shortDay) }));

  return (
    <LineChart
      points={points.map((point) => ({ key: point.date, value: point.value }))}
      label={label}
      describe={(point) => `${label}, ${formatDay(point.key, longDay)}`}
      rowHeading={(point) => formatDay(point.key, longDay)}
      tableCaption={tableCaption}
      keyHeading={dateHeading}
      ticks={ticks}
      highlight="band"
      minHeight={MIN_HEIGHT}
    />
  );
}
