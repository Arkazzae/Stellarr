import {
  Clock3,
  Cpu,
  Database,
  HardDrive,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import { formatDateTime, formatMegabytes, formatNumber } from "@/i18n/format";
import { opsApi } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

const formatMemory = (bytes: number) => formatMegabytes(bytes, 1);

/** Days and hours are left out when zero; minutes are always shown. */
function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [t("runtime.uptime.minutes", { value: minutes })];
  if (hours) parts.unshift(t("runtime.uptime.hours", { value: hours }));
  if (days) parts.unshift(t("runtime.uptime.days", { value: days }));
  return parts.join(" ");
}

interface MetricProps {
  label: string;
  value: string;
  icon: LucideIcon;
}

function Metric({ label, value, icon: Icon }: MetricProps) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-4 rounded-lg border p-4">
      <div className="grid size-9 place-items-center rounded-md bg-muted">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export function RuntimePage() {
  const { data, error, loading, refresh } = useOpsResource(
    opsApi.runtime,
    t("runtime.loadFailed"),
  );

  const metrics: MetricProps[] = data
    ? [
        { label: t("runtime.metric.uptime"), value: formatUptime(data.uptimeSeconds), icon: Clock3 },
        { label: t("runtime.metric.memory"), value: formatMemory(data.workingSetBytes), icon: HardDrive },
        { label: t("runtime.metric.gcHeap"), value: formatMemory(data.gcHeapBytes), icon: Cpu },
        { label: t("runtime.metric.threads"), value: String(data.threadCount), icon: Cpu },
        { label: t("runtime.metric.realtime"), value: String(data.realtimeConnections), icon: RadioTower },
        { label: t("runtime.metric.voiceRooms"), value: String(data.voiceRooms), icon: UsersRound },
        {
          label: t("runtime.metric.latency"),
          value: `${formatNumber(data.databaseLatencyMs)} ms`,
          icon: Database,
        },
        {
          label: t("runtime.metric.startedAt"),
          value: formatDateTime(data.startedAt),
          icon: Clock3,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("runtime.title")}
        description={t("runtime.description")}
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
            {t("runtime.refresh")}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("runtime.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!data && loading ? (
        <div
          role="status"
          className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {t("runtime.loading")}
        </div>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </section>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{t("runtime.services.title")}</CardTitle>
              <CardDescription>{t("runtime.services.description")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.service")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("runtime.services.details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.services.map((service) => (
                    <TableRow key={service.name}>
                      <TableCell className="font-medium">{service.name}</TableCell>
                      <TableCell>
                        <StatusBadge state={service.state} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{service.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
