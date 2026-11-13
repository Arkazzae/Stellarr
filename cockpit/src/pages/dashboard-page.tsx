import { Badge, Card, cx, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@stellarr/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ActivityChart } from "@/components/activity-chart";
import { AvailabilityCard } from "@/components/availability-card";
import { Icon, type IconName } from "@/components/icons/icon";
import { LineChart } from "@/components/line-chart";
import { ArcGauge, CapsuleBars, MiniCells, MiniLine, MiniStems, type MiniPoint } from "@/components/mini-charts";
import { StatTile, TileFigure, TileHeader } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { t, type MessageKey } from "@/i18n";
import { formatDay, formatNumber, formatTime } from "@/i18n/format";
import {
  cockpitApi,
  type CockpitActivity,
  type CockpitActivityDay,
  type CockpitRuntime,
  type CockpitServiceId,
} from "@/lib/api";
import { readHealth, type HealthSnapshot } from "@/lib/health";
import { bucketize } from "@/lib/sparkline";
import { weekOverWeek } from "@/lib/trend";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
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

const HOUR_MS = 60 * 60 * 1000;
/** The connections card splits the hour into this many capsules. */
const CONNECTION_PERIODS = 6;

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

const seriesInfo = (series: Series) => SERIES.find(({ key }) => key === series)!;

/** The 30-day figure on a tab: a sum, except people, who count once however many days they wrote. */
function windowTotal(activity: CockpitActivity, series: Series): number {
  if (series === "activeUsers") return activity.activeUsers;
  return activity.days.reduce((sum, day) => sum + day[series], 0);
}

const shortDay: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** A series' last `days` days as the points of a tile's chart, each naming its day and count on hover. */
function dayPoints(activity: CockpitActivity, series: Series, days = activity.days.length): MiniPoint[] {
  const name = t(seriesInfo(series).label);
  return activity.days.slice(-days).map((day) => ({
    key: day.date,
    value: day[series],
    note: `${name}, ${formatDay(day.date, shortDay)}: ${formatNumber(day[series])}`,
  }));
}

/**
 * How the series a tile charts changed on the week before, named, since it is
 * not always the tile's figure: green when it grew. Nothing while activity
 * loads or when there is no earlier week.
 */
function WeekChange({ activity, series }: { activity: CockpitActivity | null; series: Series }) {
  const change = activity ? weekOverWeek(activity.days.map((day) => day[series])) : null;
  if (change === null) return null;
  const rounded = Math.round(change);
  const name = t(seriesInfo(series).label);
  const hint = t("dashboard.delta.hint", { series: name });
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={hint}>
      <span aria-hidden="true">{name}</span>
      <Badge variant={rounded > 0 ? "success" : "secondary"} className="rounded-full py-0 tabular-nums">
        {formatNumber(rounded, { signDisplay: "exceptZero" })}%<span className="sr-only">, {hint}</span>
      </Badge>
    </span>
  );
}

/** A tile's chart box: the same height before and after its data comes, so the row does not jump. */
function TrendBox({ children }: { children?: ReactNode }) {
  return <div className="h-13">{children}</div>;
}

interface ActivityCardProps {
  activity: CockpitActivity | null;
  error: string | null;
  className?: string;
}

/**
 * The overview's main card: a series of the last 30 days as a line, the series
 * picked from pills beside the title; they move under it, and wrap, where the
 * card is narrow.
 */
function ActivityCard({ activity, error, className }: ActivityCardProps) {
  const [series, setSeries] = useState<Series>("messages");
  const title = (
    <h2 className="flex min-h-9 shrink-0 items-center text-xl tracking-[-0.01em]">{t("dashboard.activity.title")}</h2>
  );

  return (
    <Card className={cx("relative gap-0 overflow-hidden px-5 py-4", className)}>
      <div className="pointer-events-none absolute inset-0 glow-chart" aria-hidden="true" />
      <div className="relative flex flex-1 flex-col">
        {activity ? (
          <Tabs
            unstyled
            value={series}
            onValueChange={(value) => setSeries(value as Series)}
            className="flex flex-1 flex-col"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {title}
              <TabsList
                unstyled
                aria-label={t("dashboard.activity.series")}
                className="ml-auto flex max-w-full flex-wrap gap-1"
              >
                {SERIES.map(({ key, label }) => (
                  <TabsTrigger
                    unstyled
                    key={key}
                    value={key}
                    className={cx(
                      "flex shrink-0 items-baseline gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none",
                      "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      "data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground",
                    )}
                  >
                    <span className="whitespace-nowrap">{t(label)}</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatNumber(windowTotal(activity, key))}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-4 text-xs text-muted-foreground">
              <p className="min-w-0 truncate">{t(seriesInfo(series).hint)}</p>
              <span className="shrink-0">{t("dashboard.activity.window", { zone: activity.timeZone })}</span>
            </div>
            {SERIES.map(({ key, label }) => (
              <TabsContent unstyled key={key} value={key} className="flex flex-1 flex-col pt-4 outline-none">
                <ActivityChart
                  points={activity.days.map((day) => ({ date: day.date, value: day[key] }))}
                  label={t(label)}
                  tableCaption={t("dashboard.activity.table")}
                  dateHeading={t("dashboard.activity.date")}
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <>
            {title}
            {error ? (
              <p role="alert" className="py-10 text-center text-sm text-danger">
                {error}
              </p>
            ) : (
              <div
                role="status"
                className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
              >
                <Spinner />
                {t("dashboard.activity.loading")}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

interface RuntimeCardProps {
  runtime: CockpitRuntime | null;
  className?: string;
}

/** API requests over the last hour as a thin line, with their total and the server errors among them. */
function RequestsCard({ runtime, className }: RuntimeCardProps) {
  const history = runtime?.history ?? [];
  const requests = history.reduce((sum, sample) => sum + sample.requests, 0);
  const serverErrors = history.reduce((sum, sample) => sum + sample.serverErrors, 0);
  const label = t("runtime.chart.requests");

  return (
    <Card className={cx("gap-0 px-5 py-4", className)}>
      <TileHeader icon="pulse" title={t("runtime.metric.requests")}>
        <span className="text-xs">{t("runtime.lastHour")}</span>
      </TileHeader>
      <div className="mt-2 flex items-baseline gap-3">
        <TileFigure value={runtime ? formatNumber(requests) : "…"} />
        {runtime ? (
          <span className="truncate text-xs text-muted-foreground">
            {t("dashboard.requests.errors", { count: formatNumber(serverErrors) })}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        {runtime ? (
          <LineChart
            points={history.map((sample) => ({ key: sample.at, value: sample.requests }))}
            slots={Math.round(HOUR_MS / 1000 / runtime.sampleSeconds)}
            label={label}
            describe={(point) => `${label}, ${formatTime(point.key)}`}
            rowHeading={(point) => formatTime(point.key)}
            tableCaption={t("runtime.chart.requestsTable")}
            keyHeading={t("runtime.chart.time")}
            highlight="spike"
            minHeight={56}
          />
        ) : (
          <div className="min-h-14 flex-1" />
        )}
      </div>
    </Card>
  );
}

/** Live connections now, and over the last hour in ten-minute capsules named by the time each ends. */
function ConnectionsCard({ runtime, className }: RuntimeCardProps) {
  const points = runtime
    ? bucketize(runtime.history, (sample) => sample.realtimeConnections, "last", CONNECTION_PERIODS).map((point) => ({
        key: String(point.end),
        value: point.value,
        label: formatTime(point.end),
        note: point.value === null ? formatTime(point.end) : `${formatTime(point.end)}: ${formatNumber(point.value)}`,
      }))
    : [];

  return (
    <Card className={cx("gap-0 px-5 py-4", className)}>
      <TileHeader icon="wifi" title={t("runtime.metric.realtime")}>
        <span className="text-xs">{t("runtime.lastHour")}</span>
      </TileHeader>
      <div className="mt-2 flex items-baseline gap-3">
        <TileFigure value={runtime ? formatNumber(runtime.realtimeConnections) : "…"} />
        {runtime ? (
          <span className="truncate text-xs text-muted-foreground">
            {t("runtime.metric.voiceRooms", { count: runtime.voiceRooms })}
          </span>
        ) : null}
      </div>
      <div className="mt-3 min-h-20 flex-1">
        <CapsuleBars points={points} />
      </div>
    </Card>
  );
}

const SERVICE_ICON: Record<CockpitServiceId, IconName> = {
  api: "server",
  database: "database",
  realtime: "wifi",
  maintenance: "gear",
  storage: "folder",
};

/** The services the availability card leaves out, a row each with its state now. */
function ServicesCard({ runtime, className }: RuntimeCardProps) {
  const services = (runtime?.services ?? []).filter((service) => service.id !== "api" && service.id !== "database");

  return (
    <Card className={cx("gap-0 px-5 py-4", className)}>
      <TileHeader icon="server" title={t("dashboard.services.title")} />
      {services.length ? (
        <ul className="mt-2 flex flex-1 flex-col justify-center gap-1">
          {services.map((service) => (
            <li key={service.id} className="flex items-center gap-3 rounded-xl bg-background px-3 py-0.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground">
                <Icon name={SERVICE_ICON[service.id]} size={16} />
              </span>
              {/* The name labels the row and what the service reports stands under it, as a value would. */}
              <span className="min-w-0 flex-1">
                {service.detail ? (
                  <>
                    <span className="block truncate text-xs text-muted-foreground">{service.name}</span>
                    <span className="block truncate text-sm">{service.detail}</span>
                  </>
                ) : (
                  <span className="block truncate text-sm">{service.name}</span>
                )}
              </span>
              <StatusBadge state={service.state} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex flex-1 items-center justify-center py-6 text-xs text-muted-foreground">
          {t("dashboard.uptime.noData")}
        </p>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { bootstrap, reload } = useCockpit();
  const [health, setHealth] = useState<Health>(CHECKING);
  const activity = useCockpitResource(cockpitApi.activity, t("dashboard.activity.loadFailed"));
  const runtime = useCockpitResource(cockpitApi.runtime, t("dashboard.uptime.loadFailed"));
  const { refresh: refreshActivity } = activity;
  const { refresh: refreshRuntime } = runtime;

  useEffect(() => {
    const controller = new AbortController();
    readHealth(controller.signal).then(setHealth, () => {
      // An abort means the page is gone; any other failure leaves nothing to trust.
      if (!controller.signal.aborted) setHealth(UNAVAILABLE);
    });
    return () => controller.abort();
  }, []);

  // The last state stays on screen while the next one loads, so a refresh
  // every 30 s does not blink every badge to "checking".
  const refresh = useCallback(async (withActivity: boolean) => {
    const [next] = await Promise.all([
      readHealth(),
      reload(),
      withActivity ? refreshActivity() : undefined,
      refreshRuntime(),
    ]);
    setHealth(next);
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
  const days = activity.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The bar above names the page; the heading is for assistive tech. */}
      <h1 className="sr-only">{t("dashboard.title")}</h1>

      {/*
        A bento of tiles on twelve columns. On a wide screen: the four figures
        across the top; activity over two thirds with availability beside it;
        and under them the last hour of requests and connections and the
        other services, a third each.
      */}
      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:grid-rows-[auto_minmax(0,1fr)_auto]">
        <StatTile
          icon="users"
          title={t("common.users")}
          value={formatNumber(overview.userCount)}
          caption={t("dashboard.users.detail", { count: overview.onlineUserCount })}
          aside={<WeekChange activity={days} series="activeUsers" />}
          trend={<TrendBox>{days ? <MiniLine points={dayPoints(days, "activeUsers")} /> : null}</TrendBox>}
          className="xl:col-span-3"
        />
        <StatTile
          icon="send"
          title={t("dashboard.messages.title")}
          value={formatNumber(overview.messageCount)}
          caption={t("dashboard.messages.detail")}
          aside={<WeekChange activity={days} series="messages" />}
          trend={<TrendBox>{days ? <MiniStems points={dayPoints(days, "messages", 14)} /> : null}</TrendBox>}
          className="xl:col-span-3"
        />
        <StatTile
          icon="server"
          title={t("dashboard.servers.title")}
          value={formatNumber(overview.serverCount)}
          caption={t("dashboard.servers.detail", { count: overview.publicServerCount })}
          trend={
            <TrendBox>
              <ArcGauge
                part={overview.publicServerCount}
                whole={overview.serverCount}
                note={t("dashboard.servers.share", { count: overview.publicServerCount, total: overview.serverCount })}
              />
            </TrendBox>
          }
          className="xl:col-span-3"
        />
        <StatTile
          icon="folder"
          title={t("dashboard.storage.title")}
          value={formatBytes(overview.storedObjectBytes)}
          caption={t("dashboard.storage.detail")}
          aside={<WeekChange activity={days} series="uploads" />}
          trend={<TrendBox>{days ? <MiniCells points={dayPoints(days, "uploads")} recent={7} /> : null}</TrendBox>}
          className="xl:col-span-3"
        />

        <ActivityCard activity={activity.data} error={activity.error} className="sm:col-span-2 xl:col-span-8" />
        <AvailabilityCard
          runtime={runtime.data}
          error={runtime.error}
          health={health}
          className="sm:col-span-2 xl:col-span-4"
        />

        <RequestsCard runtime={runtime.data} className="xl:col-span-4" />
        <ConnectionsCard runtime={runtime.data} className="xl:col-span-4" />
        <ServicesCard runtime={runtime.data} className="sm:col-span-2 xl:col-span-4" />
      </div>
    </div>
  );
}
