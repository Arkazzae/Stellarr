import { Card, cx } from "@stellarr/ui";
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/icon";

interface TileHeaderProps {
  icon: IconName;
  title: string;
  /** Something small at the far end of the row, such as a badge. */
  children?: ReactNode;
  className?: string;
}

/** A tile's name with its icon, quiet beside the figure under it, and room for a badge at the end. */
export function TileHeader({ icon, title, children, className }: TileHeaderProps) {
  return (
    <div className={cx("flex min-h-6 items-center gap-2 text-sm text-muted-foreground", className)}>
      <Icon name={icon} size={16} />
      <h2 className="min-w-0 flex-1 truncate">{title}</h2>
      {children}
    </div>
  );
}

/** The headline figure of a tile. Proportional digits: tabular ones look loose this large. */
export function TileFigure({ value, unit, className }: { value: string; unit?: string; className?: string }) {
  return (
    <p className={cx("text-3xl leading-none font-semibold tracking-[-0.02em]", className)}>
      {value}
      {unit ? <span className="ml-1 text-base font-medium text-muted-foreground">{unit}</span> : null}
    </p>
  );
}

interface StatTileProps {
  icon: IconName;
  title: string;
  value: string;
  /** A small unit after the value, such as MB or ms. */
  unit?: string;
  caption: string;
  /** A small chart between the figure and the caption, such as its last hour. */
  trend?: ReactNode;
  /** Something at the end of the caption's line about the chart, such as how its series changed on last week. */
  aside?: ReactNode;
  className?: string;
}

/** One headline figure: its name, the value, a small chart and a line about it. Tiles in a row share a size. */
export function StatTile({ icon, title, value, unit, caption, trend, aside, className }: StatTileProps) {
  return (
    <Card role="group" aria-label={title} className={cx("gap-0 px-5 py-4", className)}>
      <TileHeader icon={icon} title={title} />
      <TileFigure value={value} unit={unit} className="mt-2" />
      {trend ? <div className="mt-3">{trend}</div> : null}
      <div className="mt-auto flex items-center gap-2 pt-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{caption}</p>
        {aside}
      </div>
    </Card>
  );
}
