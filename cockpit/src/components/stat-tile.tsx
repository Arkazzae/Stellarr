import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/icon";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatTileProps {
  icon: IconName;
  title: string;
  value: string;
  /** A small unit after the value, such as MB or ms. */
  unit?: string;
  caption: string;
  /** A small chart under the figure, such as its last hour. */
  trend?: ReactNode;
  className?: string;
}

/** One headline figure: its name, the value and a line about it. Tiles in a row share a size. */
export function StatTile({ icon, title, value, unit, caption, trend, className }: StatTileProps) {
  return (
    <Card role="group" aria-label={title} className={cn("justify-center gap-0 px-5 py-4", className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name={icon} size={16} />
        <h2 className="min-w-0 truncate font-medium">{title}</h2>
      </div>
      <p className="mt-3 text-3xl leading-none font-semibold tracking-[-0.01em] tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-base font-medium text-muted-foreground">{unit}</span> : null}
      </p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{caption}</p>
      {trend ? <div className="mt-3">{trend}</div> : null}
    </Card>
  );
}
