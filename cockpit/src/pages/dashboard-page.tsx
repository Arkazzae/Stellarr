import { useEffect, useState, type ReactNode } from "react";

import { ActivityChart } from "@/components/activity-chart";
import { Icon, type IconName } from "@/components/icons/icon";
import { Spinner } from "@/components/spinner";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t, type MessageKey } from "@/i18n";
import { formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitActivity } from "@/lib/api";
import { readHealth, type HealthCheckState, type HealthSnapshot } from "@/lib/health";
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

function HealthBadge({ state }: { state: HealthCheckState }) {
  if (state === "checking") return <Badge variant="secondary">{t("dashboard.health.checking")}</Badge>;
  return state === "healthy" ? (
    <StatusBadge state="healthy" />
  ) : (
    <StatusBadge state="error" label={t("dashboard.health.unavailable")} />
  );
}

/** A card's title row: an icon and a name above a hairline. */
function CardTitleRow({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3.5">
      <Icon name={icon} size={18} className="text-muted-foreground" />
      <h2 className="mr-auto text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
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

interface ServiceRowProps {
  icon: IconName;
  name: string;
  detail: string;
  /** Whether the detail is an identifier, set in the code face. */
  code?: boolean;
  status: ReactNode;
  origin: string;
}

function ServiceRow({ icon, name, detail, code = false, status, origin }: ServiceRowProps) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border text-muted-foreground">
            <Icon name={icon} />
          </span>
          <div>
            <p className="font-medium">{name}</p>
            <p className={cn("text-xs text-muted-foreground", code && "font-mono")}>{detail}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>{status}</TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">{origin}</TableCell>
    </TableRow>
  );
}

export function DashboardPage() {
  const { bootstrap, reload } = useCockpit();
  const [health, setHealth] = useState<Health>(CHECKING);
  const [rechecking, setRechecking] = useState(false);
  const activity = useCockpitResource(cockpitApi.activity, t("dashboard.activity.loadFailed"));

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
      const [next] = await Promise.all([readHealth(), reload(), activity.refresh()]);
      setHealth(next);
    } finally {
      setRechecking(false);
    }
  }

  if (!bootstrap) return null;
  const { overview } = bootstrap;

  // On a wide screen the overview fills the window under the bar: the window
  // less the inset frame (1rem and its 2px border), the bar (3.5rem) and the page padding (4rem).
  return (
    <div className="flex flex-col gap-4 lg:min-h-[calc(100svh-8.5rem-2px)]">
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

      <Card className="gap-0 py-0">
        <CardTitleRow icon="server" title={t("dashboard.services.title")} />
        <div className="px-3 pt-1 pb-2 sm:px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.service")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("dashboard.services.source")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ServiceRow
                icon="code"
                name="API"
                detail="/health/live"
                code
                status={<HealthBadge state={health.api} />}
                origin={t("dashboard.services.originBackend")}
              />
              <ServiceRow
                icon="clipboard"
                name="SQLite"
                detail="/health/ready"
                code
                status={<HealthBadge state={health.database} />}
                origin={t("dashboard.services.originBackend")}
              />
              <ServiceRow
                icon="wifi"
                name={t("common.realtime")}
                detail="PresenceTracker"
                code
                status={
                  <Badge variant="outline">
                    {t("dashboard.services.connections", { count: overview.realtimeConnectionCount })}
                  </Badge>
                }
                origin={t("dashboard.services.originProcess")}
              />
              <ServiceRow
                icon="image"
                name={t("dashboard.objects.title")}
                detail={t("dashboard.objects.detail")}
                status={<Badge variant="outline">{formatBytes(overview.storedObjectBytes)}</Badge>}
                origin={t("dashboard.services.originDatabase")}
              />
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
