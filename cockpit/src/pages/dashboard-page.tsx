import { useEffect, useState } from "react";

import { ActivityChart } from "@/components/activity-chart";
import { CardTitleRow } from "@/components/card-title-row";
import type { IconName } from "@/components/icons/icon";
import { Spinner } from "@/components/spinner";
import { UptimeCard } from "@/components/uptime-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t, type MessageKey } from "@/i18n";
import { formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitActivity } from "@/lib/api";
import { readHealth, type HealthSnapshot } from "@/lib/health";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { cn } from "@/lib/utils";
import { useCockpit } from "@/state/cockpit-context";

type Health = Pick<HealthSnapshot, "api" | "database">;

const CHECKING: Health = { api: "checking", database: "checking" };
const UNAVAILABLE: Health = { api: "unavailable", database: "unavailable" };

const BYTE_UNITS = ["B", "KB", "MB", "GB"];

function formatBytes(value: number): string {
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${formatNumber(size, { maximumFractionDigits: 1 })} ${BYTE_UNITS[unit]}`;
}

function MetricCard({ icon, title, value, caption }: { icon: IconName; title: string; value: string; caption: string }) {
  return (
    <Card role="group" aria-label={title} className="gap-0 py-0">
      <CardTitleRow icon={icon} title={title} />
      <div className="flex flex-1 flex-col justify-center px-5 py-5">
        <p className="text-hero font-semibold">{value}</p>
        <p className="mt-3 text-sm text-muted-foreground">{caption}</p>
      </div>
    </Card>
  );
}

type Series = "messages" | "newMembers";

const seriesLabel: Record<Series, MessageKey> = {
  messages: "dashboard.activity.messages",
  newMembers: "dashboard.activity.members",
};

function ActivityCard({ activity, error }: { activity: CockpitActivity | null; error: string | null }) {
  const [series, setSeries] = useState<Series>("messages");
  const label = t(seriesLabel[series]);

  return (
    <Card className="h-full gap-0 py-0">
      <CardTitleRow icon="signal" title={t("dashboard.activity.title")}>
        <div role="group" aria-label={t("dashboard.activity.series")} className="flex gap-1.5">
          {(Object.keys(seriesLabel) as Series[]).map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={series === key}
              onClick={() => setSeries(key)}
              className={cn(series === key ? "bg-accent" : "text-muted-foreground")}
            >
              <span
                aria-hidden="true"
                className={cn("size-2.5 rounded-[2px]", series === key ? "bg-chart-1" : "bg-chart-track")}
              />
              {t(seriesLabel[key])}
            </Button>
          ))}
        </div>
      </CardTitleRow>
      <div className="flex flex-1 flex-col px-5 pt-4 pb-5">
        {activity ? (
          <>
            <p className="mb-8 flex-1 text-sm text-muted-foreground">
              {t("dashboard.activity.description", { zone: activity.timeZone })}
            </p>
            <ActivityChart
              points={activity.days.map((day) => ({ date: day.date, value: day[series] }))}
              label={label}
              tableCaption={t("dashboard.activity.table")}
              dateHeading={t("dashboard.activity.date")}
            />
          </>
        ) : error ? (
          <p role="alert" className="py-10 text-center text-sm text-danger">
            {error}
          </p>
        ) : (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Spinner />
            {t("dashboard.activity.loading")}
          </div>
        )}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { bootstrap, reload } = useCockpit();
  const [health, setHealth] = useState<Health>(CHECKING);
  const [rechecking, setRechecking] = useState(false);
  const activity = useCockpitResource(cockpitApi.activity, t("dashboard.activity.loadFailed"));
  const runtime = useCockpitResource(cockpitApi.runtime, t("dashboard.uptime.loadFailed"));

  useEffect(() => {
    const controller = new AbortController();
    readHealth(controller.signal).then(setHealth, () => {
      // An abort means the page is gone; any other failure leaves nothing to trust.
      if (!controller.signal.aborted) setHealth(UNAVAILABLE);
    });
    return () => controller.abort();
  }, []);

  async function recheck() {
    setRechecking(true);
    setHealth(CHECKING);
    try {
      const [next] = await Promise.all([readHealth(), reload(), activity.refresh(), runtime.refresh()]);
      setHealth(next);
    } finally {
      setRechecking(false);
    }
  }

  if (!bootstrap) return null;
  const { overview } = bootstrap;

  // The overview fills the area under the bar.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{t("dashboard.title")}</h1>
        <Button variant="outline" onClick={() => void recheck()} disabled={rechecking}>
          {rechecking ? <Spinner /> : null}
          {t("dashboard.recheck")}
        </Button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2">
          <MetricCard
            icon="users"
            title={t("common.users")}
            value={formatNumber(overview.userCount)}
            caption={t("dashboard.users.detail", { count: overview.onlineUserCount })}
          />
          <MetricCard
            icon="send"
            title={t("dashboard.messages.title")}
            value={formatNumber(overview.messageCount)}
            caption={t("dashboard.messages.detail")}
          />
        </div>

        <ActivityCard activity={activity.data} error={activity.error} />
      </div>

      <UptimeCard
        runtime={runtime.data}
        error={runtime.error}
        health={health}
        realtimeConnections={overview.realtimeConnectionCount}
        storedObjects={formatBytes(overview.storedObjectBytes)}
      />
    </div>
  );
}
