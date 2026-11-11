import { useEffect } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { Icon, type IconName } from "@/components/icons/icon";
import { LineChart } from "@/components/line-chart";
import { RequestChart } from "@/components/request-chart";
import { Spinner } from "@/components/spinner";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { getLocale, t } from "@/i18n";
import { formatDateTime, formatMegabytes, formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitRuntime } from "@/lib/api";
import { formatUptime } from "@/lib/uptime";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

const MEGABYTE = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;

const formatMemory = (bytes: number) => formatMegabytes(bytes, 1);

function formatClock(at: string): string {
  return new Date(at).toLocaleTimeString(getLocale() === "pl" ? "pl-PL" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TileProps {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  caption: string;
}

/** One figure: its name, the value with a small unit, and a line about it. */
function Tile({ icon, label, value, unit, caption }: TileProps) {
  return (
    <Card role="group" aria-label={label} className="justify-center gap-0 px-5 py-3.5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name={icon} />
        {label}
      </p>
      <p className="mt-2.5 text-3xl leading-none font-semibold tracking-[-0.01em] tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-base font-medium text-muted-foreground">{unit}</span> : null}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
    </Card>
  );
}

function Tiles({ data }: { data: CockpitRuntime }) {
  const requests = data.history.reduce((sum, sample) => sum + sample.requests, 0);
  const serverErrors = data.history.reduce((sum, sample) => sum + sample.serverErrors, 0);
  const clientErrors = data.history.reduce((sum, sample) => sum + sample.clientErrors, 0);
  const [value, unit] = formatMemory(data.workingSetBytes).split(/\s(?=\S+$)/);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-rows-3">
      <Tile icon="signal" label={t("runtime.metric.requests")} value={formatNumber(requests)} caption={t("runtime.lastHour")} />
      <Tile
        icon="warning"
        label={t("runtime.metric.serverErrors")}
        value={formatNumber(serverErrors)}
        caption={t("runtime.metric.clientErrors", { count: formatNumber(clientErrors) })}
      />
      <Tile
        icon="cpu"
        label={t("runtime.metric.cpu")}
        value={formatNumber(data.cpuPercent, { maximumFractionDigits: 1 })}
        unit="%"
        caption={t("runtime.metric.cpuDetail", { seconds: data.sampleSeconds })}
      />
      <Tile
        icon="sliders"
        label={t("runtime.metric.memory")}
        value={value ?? ""}
        unit={unit}
        caption={t("runtime.metric.memoryDetail", {
          heap: formatMemory(data.gcHeapBytes),
          threads: data.threadCount,
        })}
      />
      <Tile
        icon="wifi"
        label={t("runtime.metric.realtime")}
        value={formatNumber(data.realtimeConnections)}
        caption={t("runtime.metric.voiceRooms", { count: data.voiceRooms })}
      />
      <Tile
        icon="clipboard"
        label={t("runtime.metric.latency")}
        value={formatNumber(data.databaseLatencyMs, { maximumFractionDigits: 2 })}
        unit="ms"
        caption={t("runtime.metric.latencyDetail")}
      />
    </div>
  );
}

function Charts({ data }: { data: CockpitRuntime }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-rows-2">
      <Card className="gap-0 py-0">
        <CardTitleRow icon="sliders" title={t("runtime.chart.memory")}>
          <span className="text-sm text-muted-foreground tabular-nums">{formatMemory(data.workingSetBytes)}</span>
        </CardTitleRow>
        <div className="flex flex-1 flex-col justify-end px-5 pt-8 pb-3">
          <LineChart
            points={data.history.map((sample) => ({ at: sample.at, value: sample.workingSetBytes / MEGABYTE }))}
            label={t("runtime.chart.memory")}
            formatValue={(megabytes) => `${formatNumber(Math.round(megabytes))} MB`}
            formatTime={formatClock}
            tableCaption={t("runtime.chart.memoryTable")}
            timeHeading={t("runtime.chart.time")}
            windowMs={HOUR_MS}
            height={72}
          />
        </div>
      </Card>
      <Card className="gap-0 py-0">
        <CardTitleRow icon="signal" title={t("runtime.chart.requests")}>
          <span className="text-sm text-muted-foreground">{t("runtime.chart.perInterval", { seconds: data.sampleSeconds })}</span>
        </CardTitleRow>
        <div className="flex flex-1 flex-col justify-end px-5 pt-3 pb-3">
          <RequestChart
            points={data.history.map((sample) => ({
              at: sample.at,
              ok: sample.requests - sample.serverErrors,
              serverErrors: sample.serverErrors,
            }))}
            slots={Math.round(HOUR_MS / 1000 / data.sampleSeconds)}
            label={t("runtime.chart.requests")}
            okLabel={t("runtime.chart.answered")}
            errorLabel={t("runtime.metric.serverErrors")}
            formatTime={formatClock}
            tableCaption={t("runtime.chart.requestsTable")}
            timeHeading={t("runtime.chart.time")}
            height={64}
          />
        </div>
      </Card>
    </div>
  );
}

export function RuntimePage() {
  const { data, error, loading, refresh } = useCockpitResource(
    cockpitApi.runtime,
    t("runtime.loadFailed"),
  );

  // The API takes a sample every 30 s; read along while the page is in view.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">{t("runtime.title")}</h1>
          {data ? (
            <p className="text-sm text-muted-foreground">
              {t("runtime.since", {
                uptime: formatUptime(data.uptimeSeconds),
                startedAt: formatDateTime(data.startedAt),
              })}
            </p>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Spinner /> : null}
          {t("runtime.refresh")}
        </Button>
      </div>

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
          <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Tiles data={data} />
            <Charts data={data} />
          </div>

          <Card className="min-h-0 gap-0 py-0">
            <CardTitleRow icon="server" title={t("runtime.services.title")} />
            <div className="relative min-h-0 flex-1 overflow-auto px-3 pb-2 sm:px-5">
              <Table containerClassName="overflow-visible">
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
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
