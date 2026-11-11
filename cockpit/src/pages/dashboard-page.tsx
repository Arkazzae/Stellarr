import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useCallback, useEffect, useState } from "react";

import { ActivityChart } from "@/components/activity-chart";
import { CardTitleRow } from "@/components/card-title-row";
import { Icon, type IconName } from "@/components/icons/icon";
import { Spinner } from "@/components/spinner";
import { UptimeCard } from "@/components/uptime-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, type MessageKey } from "@/i18n";
import { formatClock, formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitActivity, type CockpitActivityDay } from "@/lib/api";
import { readHealth, type HealthSnapshot } from "@/lib/health";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { cn } from "@/lib/utils";
import { useCockpit } from "@/state/cockpit-context";

type Health = Pick<HealthSnapshot, "api" | "database">;

const CHECKING: Health = { api: "checking", database: "checking" };
const UNAVAILABLE: Health = { api: "unavailable", database: "unavailable" };

/** How often the overview reads everything again: once per runtime sample. */
const REFRESH_MS = 30_000;

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

interface StatTileProps {
  icon: IconName;
  title: string;
  value: string;
  caption: string;
}

/** One headline number. The four tiles share a row, so they share a width and a height. */
function StatTile({ icon, title, value, caption }: StatTileProps) {
  return (
    <Card role="group" aria-label={title} className="gap-0 px-5 py-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name={icon} size={16} />
        <h2 className="font-medium">{title}</h2>
      </div>
      <p className="mt-3 text-3xl leading-none font-semibold tracking-[-0.01em] tabular-nums">{value}</p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{caption}</p>
    </Card>
  );
}

type Series = Exclude<keyof CockpitActivityDay, "date">;

interface SeriesInfo {
  key: Series;
  label: MessageKey;
  /** What exactly is counted, and where. */
  hint: MessageKey;
}

const SERIES: readonly SeriesInfo[] = [
  { key: "messages", label: "dashboard.activity.messages", hint: "dashboard.activity.messagesHint" },
  { key: "activeUsers", label: "dashboard.activity.activeUsers", hint: "dashboard.activity.activeUsersHint" },
  { key: "newMembers", label: "dashboard.activity.members", hint: "dashboard.activity.membersHint" },
  { key: "reactions", label: "dashboard.activity.reactions", hint: "dashboard.activity.reactionsHint" },
  { key: "uploads", label: "dashboard.activity.uploads", hint: "dashboard.activity.uploadsHint" },
  { key: "signIns", label: "dashboard.activity.signIns", hint: "dashboard.activity.signInsHint" },
];

/** The 30-day figure on a tab: a sum, except people, who count once however many days they wrote. */
function windowTotal(activity: CockpitActivity, series: Series): number {
  if (series === "activeUsers") return activity.activeUsers;
  return activity.days.reduce((sum, day) => sum + day[series], 0);
}

function ActivityCard({ activity, error }: { activity: CockpitActivity | null; error: string | null }) {
  const [series, setSeries] = useState<Series>("messages");

  return (
    <Card className="flex-1 gap-0 py-0">
      <CardTitleRow icon="signal" title={t("dashboard.activity.title")}>
        {activity ? (
          <span className="text-xs text-muted-foreground">
            {t("dashboard.activity.window", { zone: activity.timeZone })}
          </span>
        ) : null}
      </CardTitleRow>
      {activity ? (
        <TabsPrimitive.Root
          value={series}
          onValueChange={(value) => setSeries(value as Series)}
          className="flex flex-1 flex-col"
        >
          <TabsPrimitive.List
            aria-label={t("dashboard.activity.series")}
            className="flex shrink-0 overflow-x-auto border-b"
          >
            {SERIES.map(({ key, label }) => (
              <TabsPrimitive.Trigger
                key={key}
                value={key}
                className={cn(
                  "flex min-w-36 flex-1 flex-col items-start gap-1.5 border-b-2 border-transparent px-5 py-2.5 text-left transition-colors outline-none",
                  "text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50",
                  "data-[state=active]:border-chart-1 data-[state=active]:text-foreground",
                )}
              >
                <span className="text-sm whitespace-nowrap">{t(label)}</span>
                <span className="text-xl leading-none font-semibold text-foreground tabular-nums">
                  {formatNumber(windowTotal(activity, key))}
                </span>
              </TabsPrimitive.Trigger>
            ))}
          </TabsPrimitive.List>
          {SERIES.map(({ key, label, hint }) => (
            <TabsPrimitive.Content
              key={key}
              value={key}
              className="flex flex-1 flex-col gap-4 px-5 pt-3 pb-4 outline-none"
            >
              <p className="text-xs text-muted-foreground">{t(hint)}</p>
              <ActivityChart
                points={activity.days.map((day) => ({ date: day.date, value: day[key] }))}
                label={t(label)}
                tableCaption={t("dashboard.activity.table")}
                dateHeading={t("dashboard.activity.date")}
              />
            </TabsPrimitive.Content>
          ))}
        </TabsPrimitive.Root>
      ) : error ? (
        <p role="alert" className="px-5 py-10 text-center text-sm text-danger">
          {error}
        </p>
      ) : (
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner />
          {t("dashboard.activity.loading")}
        </div>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { bootstrap, reload } = useCockpit();
  const [health, setHealth] = useState<Health>(CHECKING);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activity = useCockpitResource(cockpitApi.activity, t("dashboard.activity.loadFailed"));
  const runtime = useCockpitResource(cockpitApi.runtime, t("dashboard.uptime.loadFailed"));
  const { refresh: refreshActivity } = activity;
  const { refresh: refreshRuntime } = runtime;

  useEffect(() => {
    const controller = new AbortController();
    readHealth(controller.signal).then(
      (next) => {
        setHealth(next);
        setUpdatedAt(next.checkedAt);
      },
      () => {
        // An abort means the page is gone; any other failure leaves nothing to trust.
        if (!controller.signal.aborted) setHealth(UNAVAILABLE);
      },
    );
    return () => controller.abort();
  }, []);

  // The last state stays on screen while the next one loads, so a refresh
  // every 30 s does not blink every badge to "checking".
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [next] = await Promise.all([readHealth(), reload(), refreshActivity(), refreshRuntime()]);
      setHealth(next);
      setUpdatedAt(next.checkedAt);
    } finally {
      setRefreshing(false);
    }
  }, [reload, refreshActivity, refreshRuntime]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!bootstrap) return null;
  const { overview } = bootstrap;

  // The overview fills the area under the bar: tiles, then activity taking
  // what is left, then availability.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{t("dashboard.title")}</h1>
        <div className="flex items-center gap-1">
          {updatedAt ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("dashboard.updatedAt", { time: formatClock(updatedAt) })}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("dashboard.refresh")}
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <Icon name="refresh" size={16} className={cn(refreshing && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("dashboard.refreshHint")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          icon="users"
          title={t("common.users")}
          value={formatNumber(overview.userCount)}
          caption={t("dashboard.users.detail", { count: overview.onlineUserCount })}
        />
        <StatTile
          icon="send"
          title={t("dashboard.messages.title")}
          value={formatNumber(overview.messageCount)}
          caption={t("dashboard.messages.detail")}
        />
        <StatTile
          icon="server"
          title={t("dashboard.servers.title")}
          value={formatNumber(overview.serverCount)}
          caption={t("dashboard.servers.detail", { count: overview.publicServerCount })}
        />
        <StatTile
          icon="folder"
          title={t("dashboard.storage.title")}
          value={formatBytes(overview.storedObjectBytes)}
          caption={t("dashboard.storage.detail")}
        />
      </div>

      <ActivityCard activity={activity.data} error={activity.error} />

      <UptimeCard
        runtime={runtime.data}
        error={runtime.error}
        health={health}
        realtimeConnections={overview.realtimeConnectionCount}
      />
    </div>
  );
}
