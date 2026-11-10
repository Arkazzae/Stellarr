import {
  Activity,
  Database,
  HardDrive,
  Info,
  MessageSquareText,
  RefreshCw,
  Server,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
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
  return `${size.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} ${BYTE_UNITS[unit]}`;
}

function HealthBadge({ state }: { state: HealthCheckState }) {
  if (state === "checking") return <Badge variant="secondary">Sprawdzanie</Badge>;
  return state === "healthy" ? (
    <StatusBadge state="healthy" label="Działa" />
  ) : (
    <StatusBadge state="error" label="Niedostępne" />
  );
}

interface CounterProps {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}

function Counter({ title, value, detail, icon: Icon }: CounterProps) {
  return (
    <Card role="group" aria-label={title} className="gap-4 py-5 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-4 px-5">
        <CardDescription>{title}</CardDescription>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="px-5">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

interface ServiceRowProps {
  icon: LucideIcon;
  name: string;
  endpoint: string;
  status: ReactNode;
  origin: string;
}

function ServiceRow({ icon: Icon, name, endpoint, status, origin }: ServiceRowProps) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-md border bg-muted/40">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{endpoint}</p>
          </div>
        </div>
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
        title="Przegląd instancji"
        description={`Stan usług i rzeczywiste liczniki dla ${instance.name}.`}
        actions={
          <Button variant="outline" onClick={() => void recheck()} disabled={rechecking}>
            <RefreshCw className={rechecking ? "animate-spin" : undefined} aria-hidden="true" />
            Sprawdź ponownie
          </Button>
        }
      />

      <section aria-label="Podsumowanie" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Counter
          title="Użytkownicy"
          value={overview.userCount.toLocaleString("pl-PL")}
          detail={`${overview.onlineUserCount} w sieci`}
          icon={UsersRound}
        />
        <Counter
          title="Połączenia realtime"
          value={overview.realtimeConnectionCount.toLocaleString("pl-PL")}
          detail="aktywne połączenia SignalR"
          icon={Activity}
        />
        <Counter
          title="Obiekty"
          value={formatBytes(overview.storedObjectBytes)}
          detail="według metadanych w bazie"
          icon={HardDrive}
        />
        <Counter
          title="Wiadomości"
          value={overview.messageCount.toLocaleString("pl-PL")}
          detail="na kanałach serwera"
          icon={MessageSquareText}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Usługi z aktywnym healthcheckiem</CardTitle>
            <CardDescription>Stan API i możliwość połączenia z SQLite.</CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usługa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Źródło</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <ServiceRow
                  icon={Server}
                  name="API"
                  endpoint="/health/live"
                  status={<HealthBadge state={health.api} />}
                  origin="backend"
                />
                <ServiceRow
                  icon={Database}
                  name="SQLite"
                  endpoint="/health/ready"
                  status={<HealthBadge state={health.database} />}
                  origin="backend"
                />
                <ServiceRow
                  icon={Activity}
                  name="Realtime"
                  endpoint="PresenceTracker"
                  status={<Badge variant="outline">{overview.realtimeConnectionCount} połączeń</Badge>}
                  origin="pamięć procesu"
                />
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Zakres kontraktu</CardTitle>
            <CardDescription>Co panel odczytuje dzisiaj.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Podłączone</p>
              <p className="mt-1 leading-6 text-muted-foreground">
                Właściciel, instancja, użytkownicy, role, obecność, liczniki treści i ustawienia.
              </p>
            </div>
            <div className="border-t pt-4">
              <p className="font-medium">Jeszcze bez modelu domenowego</p>
              <p className="mt-1 leading-6 text-muted-foreground">
                TURN pozostaje widokiem projektowym.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>Panel nie zgaduje stanu procesów</AlertTitle>
        <AlertDescription>
          Brakujące obszary dostaną dane dopiero z dedykowanych kontraktów i trwałych modeli backendu.
        </AlertDescription>
      </Alert>
    </div>
  );
}
