import { Badge, Card, cx } from "@stellarr/ui";

import { ServiceUptime, UptimeAxis } from "@/components/service-uptime";
import { TileFigure, TileHeader } from "@/components/stat-tile";
import { t } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import type { CockpitRuntime } from "@/lib/api";
import type { HealthCheckState } from "@/lib/health";
import { formatUptime, minuteSlots, slotStates } from "@/lib/uptime";

function CurrentState({ state }: { state: HealthCheckState }) {
  if (state === "checking") return <Badge variant="secondary">{t("dashboard.health.checking")}</Badge>;
  return state === "healthy" ? (
    <Badge variant="success">{t("status.healthy")}</Badge>
  ) : (
    <Badge variant="destructive">{t("dashboard.health.unavailable")}</Badge>
  );
}

interface AvailabilityCardProps {
  runtime: CockpitRuntime | null;
  error: string | null;
  health: { api: HealthCheckState; database: HealthCheckState };
  className?: string;
}

/**
 * How long the API has run, and how available it and the database have been
 * over the last hour, a segment per minute in the style of a status page,
 * with their state now from the health probes.
 */
export function AvailabilityCard({ runtime, error, health, className }: AvailabilityCardProps) {
  const { end, slots } = minuteSlots(runtime?.history ?? []);
  const checking = health.api === "checking" || health.database === "checking";
  const allUp = health.api === "healthy" && health.database === "healthy";

  return (
    <Card className={cx("gap-0 px-5 py-4", className)}>
      <TileHeader icon="clock" title={t("dashboard.uptime.title")}>
        {checking ? null : (
          <Badge variant={allUp ? "success" : "destructive"} className="rounded-full">
            {allUp ? t("dashboard.uptime.allUp") : t("dashboard.uptime.someDown")}
          </Badge>
        )}
      </TileHeader>
      <TileFigure value={runtime ? formatUptime(runtime.uptimeSeconds) : "…"} className="mt-2" />
      <p className="mt-1.5 truncate text-xs text-muted-foreground">
        {runtime ? t("dashboard.uptime.started", { date: formatDateTime(runtime.startedAt) }) : " "}
      </p>
      <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-1.5">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <ServiceUptime
          name="API"
          states={slotStates(slots, () => true)}
          end={end}
          badge={<CurrentState state={health.api} />}
        />
        <ServiceUptime
          name={t("dashboard.uptime.database")}
          states={slotStates(slots, (sample) => sample.databaseUp)}
          end={end}
          badge={<CurrentState state={health.database} />}
        />
        <UptimeAxis />
      </div>
    </Card>
  );
}
