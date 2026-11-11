import { useEffect } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { RequestChart } from "@/components/request-chart";
import { ServiceUptime, UptimeAxis } from "@/components/service-uptime";
import { Sparkbars } from "@/components/sparkbars";
import { Spinner } from "@/components/spinner";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getLocale, t } from "@/i18n";
import { formatDateTime, formatMegabytes, formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitRuntime, type CockpitRuntimeSample } from "@/lib/api";
import { bucketize } from "@/lib/sparkline";
import { formatUptime, minuteSlots, serviceSlotStates } from "@/lib/uptime";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { useMeasuredHeight } from "@/lib/use-measured-height";
import { cn } from "@/lib/utils";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Room the request chart takes outside its plot (the legend and the time
 * axis) and its least plot height, in px at the default font size; they grow
 * with the panel's scale.
 */
const REQUEST_CHART_CHROME = 56;
const MIN_PLOT = 64;

const formatMemory = (bytes: number) => formatMegabytes(bytes, 1);

function formatClock(at: string): string {
  return new Date(at).toLocaleTimeString(getLocale() === "pl" ? "pl-PL" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TrendProps {
  history: readonly CockpitRuntimeSample[];
  pick: (sample: CockpitRuntimeSample) => number;
  combine: "sum" | "last";
  format: (value: number) => string;
  tone?: "accent" | "danger";
}

/** A tile's last hour, in two-minute bars. */
function Trend({ history, pick, combine, format, tone }: TrendProps) {
  return <Sparkbars points={bucketize(history, pick, combine)} format={format} tone={tone} />;
}

/** The six figures, each with its last hour, as tiles of one size; their grid places them. */
function MetricTiles({ data }: { data: CockpitRuntime }) {
  const history = data.history;
  const requests = history.reduce((sum, sample) => sum + sample.requests, 0);
  const serverErrors = history.reduce((sum, sample) => sum + sample.serverErrors, 0);
  const clientErrors = history.reduce((sum, sample) => sum + sample.clientErrors, 0);
  const [value, unit] = formatMemory(data.workingSetBytes).split(/\s(?=\S+$)/);
  const count = (amount: number) => formatNumber(amount);

  return (
    <>
      <StatTile
        icon="signal"
        title={t("runtime.metric.requests")}
        value={formatNumber(requests)}
        caption={t("runtime.lastHour")}
        trend={<Trend history={history} pick={(sample) => sample.requests} combine="sum" format={count} />}
      />
      <StatTile
        icon="warning"
        title={t("runtime.metric.serverErrors")}
        value={formatNumber(serverErrors)}
        caption={t("runtime.metric.clientErrors", { count: formatNumber(clientErrors) })}
        trend={
          <Trend history={history} pick={(sample) => sample.serverErrors} combine="sum" format={count} tone="danger" />
        }
      />
      <StatTile
        icon="cpu"
        title={t("runtime.metric.cpu")}
        value={formatNumber(data.cpuPercent, { maximumFractionDigits: 1 })}
        unit="%"
        caption={t("runtime.metric.cpuDetail", { seconds: data.sampleSeconds })}
        trend={
          <Trend
            history={history}
            pick={(sample) => sample.cpuPercent}
            combine="last"
            format={(percent) => `${formatNumber(percent, { maximumFractionDigits: 1 })}%`}
          />
        }
      />
      <StatTile
        icon="sliders"
        title={t("runtime.metric.memory")}
        value={value ?? ""}
        unit={unit}
        caption={t("runtime.metric.memoryDetail", {
          heap: formatMemory(data.gcHeapBytes),
          threads: data.threadCount,
        })}
        trend={<Trend history={history} pick={(sample) => sample.workingSetBytes} combine="last" format={formatMemory} />}
      />
      <StatTile
        icon="wifi"
        title={t("runtime.metric.realtime")}
        value={formatNumber(data.realtimeConnections)}
        caption={t("runtime.metric.voiceRooms", { count: data.voiceRooms })}
        trend={<Trend history={history} pick={(sample) => sample.realtimeConnections} combine="last" format={count} />}
      />
      <StatTile
        icon="clipboard"
        title={t("runtime.metric.latency")}
        value={formatNumber(data.databaseLatencyMs, { maximumFractionDigits: 2 })}
        unit="ms"
        caption={t("runtime.metric.latencyDetail")}
        trend={
          <Trend
            history={history}
            pick={(sample) => sample.databaseLatencyMs}
            combine="last"
            format={(ms) => `${formatNumber(ms, { maximumFractionDigits: 2 })} ms`}
          />
        }
      />
    </>
  );
}

/** Requests per sample over the hour, filling the height it is given. */
function RequestsChart({ data, className }: { data: CockpitRuntime; className?: string }) {
  const [plot, height, remPx] = useMeasuredHeight<HTMLDivElement>(MIN_PLOT + REQUEST_CHART_CHROME);
  const scale = remPx / 16;
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardTitleRow icon="signal" title={t("runtime.chart.requests")}>
        <span className="text-sm text-muted-foreground">{t("runtime.chart.perInterval", { seconds: data.sampleSeconds })}</span>
      </CardTitleRow>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-3">
        <div ref={plot} className="min-h-0 flex-1">
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
            height={Math.max(MIN_PLOT * scale, height - REQUEST_CHART_CHROME * scale)}
          />
        </div>
      </div>
    </Card>
  );
}

/** Every service the API reports on, with its last hour as a bar per minute and its state now. */
function ServicesCard({ data, className }: { data: CockpitRuntime; className?: string }) {
  const { end, slots } = minuteSlots(data.history);
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardTitleRow icon="server" title={t("runtime.services.title")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        {data.services.map((service) => (
          <ServiceUptime
            key={service.id}
            name={service.name}
            detail={service.detail}
            states={serviceSlotStates(slots, service)}
            end={end}
            badge={<StatusBadge state={service.state} />}
          />
        ))}
        <UptimeAxis />
      </div>
    </Card>
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
        // A bento: the six figures in two rows of three with the request chart
        // under them, and beside them a column with every service's last hour.
        <div className="grid flex-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="grid min-h-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-rows-[auto_auto_minmax(0,1fr)]">
            <MetricTiles data={data} />
            <RequestsChart data={data} className="col-span-full" />
          </div>
          <ServicesCard data={data} />
        </div>
      ) : null}
    </div>
  );
}
