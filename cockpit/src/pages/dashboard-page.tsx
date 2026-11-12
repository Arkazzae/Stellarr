import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActivityChart } from "@/components/activity-chart";
import { CardTitleRow } from "@/components/card-title-row";
import { Icon } from "@/components/icons/icon";
import { Spinner } from "@/components/spinner";
import { AvailabilityCard } from "@/components/availability-card";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, type MessageKey } from "@/i18n";
import { formatClock, formatDateTime, formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitActivity, type CockpitActivityDay } from "@/lib/api";
import { readHealth, type HealthSnapshot } from "@/lib/health";
import { formatUptime } from "@/lib/uptime";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { cn } from "@/lib/utils";
import { useCockpit } from "@/state/cockpit-context";

type Health = Pick<HealthSnapshot, "api" | "database">;

const CHECKING: Health = { api: "checking", database: "checking" };
const UNAVAILABLE: Health = { api: "unavailable", database: "unavailable" };

/** How often the overview reads its state again: once per runtime sample. */
const REFRESH_MS = 30_000;
/**
 * Activity counts days, so it is read on every tenth refresh only (5 min):
 * each read goes over a month of messages.
 */
const ACTIVITY_EVERY = 10;

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

interface ActivityCardProps {
  activity: CockpitActivity | null;
  error: string | null;
  className?: string;
}

function ActivityCard({ activity, error, className }: ActivityCardProps) {
  const [series, setSeries] = useState<Series>("messages");

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardTitleRow icon="chart" title={t("dashboard.activity.title")}>
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
                  "flex min-w-28 flex-1 flex-col items-start gap-1.5 border-b-2 border-transparent px-5 py-2.5 text-left transition-colors outline-none",
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
  const refresh = useCallback(async (withActivity: boolean) => {
    setRefreshing(true);
    try {
      const [next] = await Promise.all([
        readHealth(),
        reload(),
        withActivity ? refreshActivity() : undefined,
        refreshRuntime(),
      ]);
      setHealth(next);
      setUpdatedAt(next.checkedAt);
    } finally {
      setRefreshing(false);
    }
  }, [reload, refreshActivity, refreshRuntime]);

  const ticks = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      ticks.current += 1;
      void refresh(ticks.current % ACTIVITY_EVERY === 0);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!bootstrap) return null;
  const { overview } = bootstrap;

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
                onClick={() => void refresh(true)}
              >
                <Icon name="refresh" size={16} className={cn(refreshing && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("dashboard.refreshHint")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/*
        A bento of tiles. On a wide screen: the four figures across the top, then
        activity over three columns with, beside it, how long the API has run
        above how available it has been.
      */}
      <div className="grid flex-1 grid-cols-2 gap-4 xl:grid-cols-4 xl:grid-rows-[auto_auto_minmax(0,1fr)]">
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

        <ActivityCard
          activity={activity.data}
          error={activity.error}
          className="col-span-2 xl:col-span-3 xl:row-span-2"
        />

        <StatTile
          icon="clock"
          title={t("dashboard.uptime.since")}
          value={runtime.data ? formatUptime(runtime.data.uptimeSeconds) : "…"}
          caption={runtime.data ? t("dashboard.uptime.started", { date: formatDateTime(runtime.data.startedAt) }) : ""}
          className="col-span-2 md:col-span-1"
        />
        <AvailabilityCard
          runtime={runtime.data}
          error={runtime.error}
          health={health}
          className="col-span-2 md:col-span-1"
        />
      </div>
    </div>
  );
}
