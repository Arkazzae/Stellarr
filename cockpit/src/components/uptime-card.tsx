import { CardTitleRow } from "@/components/card-title-row";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getLocale, t, type MessageKey } from "@/i18n";
import { formatDateTime, formatNumber } from "@/i18n/format";
import type { CockpitRuntime } from "@/lib/api";
import type { HealthCheckState } from "@/lib/health";
import { formatUptime, minuteSlots, SLOTS, uptimeShare, MINUTE_MS, type SlotState } from "@/lib/uptime";
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

function CurrentState({ state }: { state: HealthCheckState }) {
  if (state === "checking") return <Badge variant="secondary">{t("dashboard.health.checking")}</Badge>;
  return state === "healthy" ? (
    <Badge variant="success">{t("status.healthy")}</Badge>
  ) : (
    <Badge variant="destructive">{t("dashboard.health.unavailable")}</Badge>
  );
}

interface ServiceLineProps {
  name: string;
  detail: string;
  states: readonly SlotState[];
  end: number;
  current: HealthCheckState;
}

/** A service's last hour as a row of minute bars, with its share of uptime. */
function ServiceLine({ name, detail, states, end, current }: ServiceLineProps) {
  const share = uptimeShare(states);
  const label = share === null ? t("dashboard.uptime.noData") : t("dashboard.uptime.percent", { value: formatNumber(share, { maximumFractionDigits: 1 }) });
  return (
    <div role="group" aria-label={name} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">{name}</span>
          <span className="ml-2 text-muted-foreground">{detail}</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">{label}</span>
          <CurrentState state={current} />
        </div>
      </div>
      <div className="flex h-6 gap-[2px]" aria-hidden="true">
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
    </div>
  );
}

interface UptimeCardProps {
  runtime: CockpitRuntime | null;
  error: string | null;
  health: { api: HealthCheckState; database: HealthCheckState };
  realtimeConnections: number;
}

/**
 * How long the process has run and how available the API and the database
 * have been over the last hour, a bar per minute in the style of a status page.
 */
export function UptimeCard({ runtime, error, health, realtimeConnections }: UptimeCardProps) {
  const { end, slots } = minuteSlots(runtime?.history ?? []);
  const apiStates: SlotState[] = slots.map((samples) => (samples.length > 0 ? "up" : "none"));
  const databaseStates: SlotState[] = slots.map((samples) =>
    samples.length === 0 ? "none" : samples.every((sample) => sample.databaseUp) ? "up" : "down",
  );
  const checking = health.api === "checking" || health.database === "checking";
  const allUp = health.api === "healthy" && health.database === "healthy";

  return (
    <Card className="gap-0 py-0">
      <CardTitleRow icon="wifi" title={t("dashboard.uptime.title")}>
        {checking ? null : (
          <Badge variant={allUp ? "success" : "destructive"}>
            {allUp ? t("dashboard.uptime.allUp") : t("dashboard.uptime.someDown")}
          </Badge>
        )}
      </CardTitleRow>
      <div className="grid gap-6 px-5 py-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">{t("dashboard.uptime.since")}</p>
            <p className="mt-1 text-3xl leading-none font-semibold tracking-[-0.01em]">
              {runtime ? formatUptime(runtime.uptimeSeconds) : "…"}
            </p>
            {runtime ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("dashboard.uptime.started", { date: formatDateTime(runtime.startedAt) })}
              </p>
            ) : null}
          </div>
          <dl className="text-sm">
            <dt className="text-xs text-muted-foreground">{t("dashboard.uptime.connections")}</dt>
            <dd className="font-medium tabular-nums">{formatNumber(realtimeConnections)}</dd>
          </dl>
        </div>
        <div className="space-y-4">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <ServiceLine
            name="API"
            detail={t("dashboard.uptime.apiDetail")}
            states={apiStates}
            end={end}
            current={health.api}
          />
          <ServiceLine
            name={t("dashboard.uptime.database")}
            detail={t("dashboard.uptime.databaseDetail")}
            states={databaseStates}
            end={end}
            current={health.database}
          />
          <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
            <span>{t("dashboard.uptime.hourAgo")}</span>
            <span>{t("dashboard.uptime.now")}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
