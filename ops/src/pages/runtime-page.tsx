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
import { opsApi } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

const megabytes = new Intl.NumberFormat("pl-PL", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});

function formatMemory(bytes: number): string {
  return megabytes.format(bytes / 1024 / 1024);
}

/** Days and hours are left out when zero; minutes are always shown. */
function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [`${minutes} min`];
  if (hours) parts.unshift(`${hours} h`);
  if (days) parts.unshift(`${days} d`);
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
    "Nie udało się pobrać metryk runtime.",
  );

  const metrics: MetricProps[] = data
    ? [
        { label: "Czas działania", value: formatUptime(data.uptimeSeconds), icon: Clock3 },
        { label: "Pamięć procesu", value: formatMemory(data.workingSetBytes), icon: HardDrive },
        { label: "Sterta GC", value: formatMemory(data.gcHeapBytes), icon: Cpu },
        { label: "Wątki procesu", value: String(data.threadCount), icon: Cpu },
        { label: "Połączenia realtime", value: String(data.realtimeConnections), icon: RadioTower },
        { label: "Aktywne pokoje głosowe", value: String(data.voiceRooms), icon: UsersRound },
        {
          label: "Opóźnienie SQLite",
          value: `${data.databaseLatencyMs.toLocaleString("pl-PL")} ms`,
          icon: Database,
        },
        {
          label: "Start procesu",
          value: new Date(data.startedAt).toLocaleString("pl-PL"),
          icon: Clock3,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runtime"
        description="Metryki procesu API, bazy danych, realtime i usług infrastruktury."
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
            Odśwież dane
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Błąd runtime</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!data && loading ? (
        <div
          role="status"
          className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          Wczytywanie metryk
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
              <CardTitle>Usługi</CardTitle>
              <CardDescription>Kontrole wykonane przez działający proces backendu.</CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usługa</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Szczegóły</TableHead>
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
