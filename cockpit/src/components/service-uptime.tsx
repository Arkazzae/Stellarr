import type { ReactNode } from "react";

import { getLocale, t, type MessageKey } from "@/i18n";
import { formatNumber } from "@/i18n/format";
import { MINUTE_MS, SLOTS, uptimeShare, type SlotState } from "@/lib/uptime";
import { cn } from "@/lib/utils";

const SLOT_CLASS: Record<SlotState, string> = {
  up: "bg-success",
  down: "bg-danger",
  none: "bg-chart-track",
};

const SLOT_LABEL: Record<SlotState, MessageKey> = {
  up: "dashboard.uptime.slotUp",
  down: "dashboard.uptime.slotDown",
  none: "dashboard.uptime.slotNone",
};

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(getLocale() === "pl" ? "pl-PL" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

interface ServiceUptimeProps {
  name: string;
  detail: string;
  states: readonly SlotState[];
  /** When the last minute ends. */
  end: number;
  /** The service's state now, as a badge. */
  badge: ReactNode;
  /** The bars' height; they grow into the space given unless fixed. */
  barsClassName?: string;
}

/** A service's last hour as a bar per minute, with its share of uptime and its state now beside its name. */
export function ServiceUptime({ name, detail, states, end, badge, barsClassName }: ServiceUptimeProps) {
  const share = uptimeShare(states);
  const label =
    share === null
      ? t("dashboard.uptime.noData")
      : t("dashboard.uptime.percent", { value: formatNumber(share, { maximumFractionDigits: 1 }) });
  return (
    <div role="group" aria-label={name} className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{label}</span>
        {badge}
      </div>
      <div className={cn("flex min-h-4 flex-1 gap-px", barsClassName)} aria-hidden="true">
        {states.map((state, index) => {
          const at = end - (SLOTS - 1 - index) * MINUTE_MS;
          return (
            <span
              key={index}
              title={t(SLOT_LABEL[state], { time: clock(at) })}
              className={cn("min-w-0 flex-1 rounded-[2px]", SLOT_CLASS[state])}
            />
          );
        })}
      </div>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

/** The time axis under a column of service bars. */
export function UptimeAxis() {
  return (
    <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
      <span>{t("dashboard.uptime.hourAgo")}</span>
      <span>{t("dashboard.uptime.now")}</span>
    </div>
  );
}
