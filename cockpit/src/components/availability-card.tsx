import { CardTitleRow } from "@/components/card-title-row";
import { ServiceUptime, UptimeAxis } from "@/components/service-uptime";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { t } from "@/i18n";
import type { CockpitRuntime } from "@/lib/api";
import type { HealthCheckState } from "@/lib/health";
import { minuteSlots, slotStates } from "@/lib/uptime";
import { cn } from "@/lib/utils";

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
 * How available the API and the database have been over the last hour, a bar
 * per minute in the style of a status page, with their state now from the
 * health probes. Its bars grow with the height it is given.
 */
export function AvailabilityCard({ runtime, error, health, className }: AvailabilityCardProps) {
  const { end, slots } = minuteSlots(runtime?.history ?? []);
  const checking = health.api === "checking" || health.database === "checking";
  const allUp = health.api === "healthy" && health.database === "healthy";

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardTitleRow icon="wifi" title={t("dashboard.uptime.title")}>
        {checking ? null : (
          <Badge variant={allUp ? "success" : "destructive"}>
            {allUp ? t("dashboard.uptime.allUp") : t("dashboard.uptime.someDown")}
          </Badge>
        )}
      </CardTitleRow>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <ServiceUptime
          name="API"
          detail={t("dashboard.uptime.apiDetail")}
          states={slotStates(slots, () => true)}
          end={end}
          badge={<CurrentState state={health.api} />}
        />
        <ServiceUptime
          name={t("dashboard.uptime.database")}
          detail={t("dashboard.uptime.databaseDetail")}
          states={slotStates(slots, (sample) => sample.databaseUp)}
          end={end}
          badge={<CurrentState state={health.database} />}
        />
        <UptimeAxis />
      </div>
    </Card>
  );
}
