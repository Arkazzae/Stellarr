import { Spinner } from "@/components/spinner";
import { PageHeader } from "@/components/page-header";
import { Stat, StatGrid } from "@/components/stats";
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
import { cockpitApi } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

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

export function RuntimePage() {
  const { data, error, loading, refresh } = useCockpitResource(
    cockpitApi.runtime,
    t("runtime.loadFailed"),
  );

  const metrics: { label: string; value: string }[] = data
    ? [
        { label: t("runtime.metric.uptime"), value: formatUptime(data.uptimeSeconds) },
        { label: t("runtime.metric.memory"), value: formatMemory(data.workingSetBytes) },
        { label: t("runtime.metric.gcHeap"), value: formatMemory(data.gcHeapBytes) },
        { label: t("runtime.metric.threads"), value: String(data.threadCount) },
        { label: t("runtime.metric.realtime"), value: String(data.realtimeConnections) },
        { label: t("runtime.metric.voiceRooms"), value: String(data.voiceRooms) },
        {
          label: t("runtime.metric.latency"),
          value: `${formatNumber(data.databaseLatencyMs)} ms`,
        },
        {
          label: t("runtime.metric.startedAt"),
          value: formatDateTime(data.startedAt),
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
            {loading ? <Spinner /> : null}
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
          <Spinner />
          {t("runtime.loading")}
        </div>
      ) : null}

      {data ? (
        <>
          <StatGrid className="sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Stat key={metric.label} {...metric} />
            ))}
          </StatGrid>

          <Card>
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
