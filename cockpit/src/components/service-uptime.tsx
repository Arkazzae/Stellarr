import { cx } from "@stellarr/ui";
import type { ReactNode } from "react";

import { getLocale, t, type MessageKey } from "@/i18n";
import { formatNumber } from "@/i18n/format";
import { MINUTE_MS, SLOTS, uptimeShare, type SlotState } from "@/lib/uptime";

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
  /** A line under the bars about what is checked; left out where space is short. */
  detail?: string;
  states: readonly SlotState[];
  /** When the last minute ends. */
  end: number;
  /** The service's state now, as a badge. */
  badge: ReactNode;
}

/** A service's last hour as a bar per minute, with its share of uptime and its state now beside its name. */
export function ServiceUptime({ name, detail, states, end, badge }: ServiceUptimeProps) {
  const share = uptimeShare(states);
  const label =
    share === null
      ? t("dashboard.uptime.noData")
      : t("dashboard.uptime.percent", { value: formatNumber(share, { maximumFractionDigits: 1 }) });
  return (
    <div role="group" aria-label={name} className="flex min-h-0 flex-1 flex-col justify-center gap-1">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{label}</span>
        {badge}
      </div>
      {/* A segment per minute at a fixed height: the room a card gives its services goes between them, not into the bars. */}
      <div className="flex h-5 gap-0.5" aria-hidden="true">
        {states.map((state, index) => {
          const at = end - (SLOTS - 1 - index) * MINUTE_MS;
          return (
            <span
              key={index}
              title={t(SLOT_LABEL[state], { time: clock(at) })}
              className={cx("min-w-0 flex-1 rounded-xs", SLOT_CLASS[state])}
            />
          );
        })}
      </div>
      {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
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
