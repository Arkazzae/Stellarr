import { RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { Stat, StatGrid } from "@/components/stats";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import { formatNumber } from "@/i18n/format";
import { readHealth, type HealthCheckState, type HealthSnapshot } from "@/lib/health";
import { useOps } from "@/state/ops-context";

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

interface ServiceRowProps {
  name: string;
  endpoint: string;
  status: ReactNode;
  origin: string;
}

function ServiceRow({ name, endpoint, status, origin }: ServiceRowProps) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{name}</p>
        <p className="font-mono text-xs text-muted-foreground">{endpoint}</p>
      </TableCell>
      <TableCell>{status}</TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">{origin}</TableCell>
    </TableRow>
  );
}

export function DashboardPage() {
  const { bootstrap, reload } = useOps();
  const [health, setHealth] = useState<Health>(CHECKING);
  const [rechecking, setRechecking] = useState(false);

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
      const [next] = await Promise.all([readHealth(), reload()]);
      setHealth(next);
    } finally {
      setRechecking(false);
    }
  }

  if (!bootstrap) return null;
  const { instance, overview } = bootstrap;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.description", { name: instance.name })}
        actions={
          <Button variant="outline" onClick={() => void recheck()} disabled={rechecking}>
            <RefreshCw className={rechecking ? "animate-spin" : undefined} aria-hidden="true" />
            {t("dashboard.recheck")}
          </Button>
        }
      />

      <StatGrid label={t("dashboard.summary")} className="sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t("common.users")}
          value={formatNumber(overview.userCount)}
          detail={t("dashboard.users.detail", { count: overview.onlineUserCount })}
        />
        <Stat
          label={t("dashboard.realtime.title")}
          value={formatNumber(overview.realtimeConnectionCount)}
          detail={t("dashboard.realtime.detail")}
        />
        <Stat
          label={t("dashboard.objects.title")}
          value={formatBytes(overview.storedObjectBytes)}
          detail={t("dashboard.objects.detail")}
        />
        <Stat
          label={t("dashboard.messages.title")}
          value={formatNumber(overview.messageCount)}
          detail={t("dashboard.messages.detail")}
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.services.title")}</CardTitle>
            <CardDescription>{t("dashboard.services.description")}</CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
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
                  name="API"
                  endpoint="/health/live"
                  status={<HealthBadge state={health.api} />}
                  origin={t("dashboard.services.originBackend")}
                />
                <ServiceRow
                  name="SQLite"
                  endpoint="/health/ready"
                  status={<HealthBadge state={health.database} />}
                  origin={t("dashboard.services.originBackend")}
                />
                <ServiceRow
                  name={t("common.realtime")}
                  endpoint="PresenceTracker"
                  status={
                    <Badge variant="outline">
                      {t("dashboard.services.connections", { count: overview.realtimeConnectionCount })}
                    </Badge>
                  }
                  origin={t("dashboard.services.originProcess")}
                />
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.contract.title")}</CardTitle>
            <CardDescription>{t("dashboard.contract.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">{t("dashboard.contract.connected")}</p>
              <p className="mt-1 leading-6 text-muted-foreground">
                {t("dashboard.contract.connectedDetail")}
              </p>
            </div>
            <div className="border-t pt-4">
              <p className="font-medium">{t("dashboard.contract.pending")}</p>
              <p className="mt-1 leading-6 text-muted-foreground">
                {t("dashboard.contract.pendingDetail")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <AlertTitle>{t("dashboard.notice.title")}</AlertTitle>
        <AlertDescription>{t("dashboard.notice.description")}</AlertDescription>
      </Alert>
    </div>
  );
}
