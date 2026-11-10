import { Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { opsApi, type OpsAuditEntry, type OpsLogEntry } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

const formatTime = (value: string) => new Date(value).toLocaleString("pl-PL");

/** `query` must already be lower-cased with the same locale. */
function containsQuery(text: string, query: string): boolean {
  return text.toLocaleLowerCase("pl").includes(query);
}

function LogLevel({ level }: { level: OpsLogEntry["level"] }) {
  if (level === "error") return <Badge variant="destructive">Błąd</Badge>;
  if (level === "warn") return <Badge variant="warning">Ostrzeżenie</Badge>;
  return <Badge variant="outline">Informacja</Badge>;
}

function EmptyRow({ columns, children }: { columns: number; children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="h-28 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function LogTable({ entries }: { entries: OpsLogEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Czas</TableHead>
          <TableHead>Poziom</TableHead>
          <TableHead>Źródło</TableHead>
          <TableHead>Komunikat</TableHead>
          <TableHead>Trace</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Entries carry no id and may share a timestamp, so rows are told apart by position. */}
        {entries.map((entry, position) => (
          <TableRow key={position}>
            <TableCell className="whitespace-nowrap font-mono text-xs">{formatTime(entry.at)}</TableCell>
            <TableCell>
              <LogLevel level={entry.level} />
            </TableCell>
            <TableCell className="font-mono text-xs">{entry.source}</TableCell>
            <TableCell className="max-w-xl whitespace-normal">{entry.message}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {entry.traceId || "—"}
            </TableCell>
          </TableRow>
        ))}
        {entries.length === 0 ? <EmptyRow columns={5}>Brak logów pasujących do filtrów.</EmptyRow> : null}
      </TableBody>
    </Table>
  );
}

function AuditTable({ entries }: { entries: OpsAuditEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Czas</TableHead>
          <TableHead>Aktor</TableHead>
          <TableHead>Operacja</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatTime(entry.at)}</TableCell>
            <TableCell className="font-medium">{entry.actor}</TableCell>
            <TableCell>{entry.summary}</TableCell>
          </TableRow>
        ))}
        {entries.length === 0 ? <EmptyRow columns={3}>Brak wpisów audytowych.</EmptyRow> : null}
      </TableBody>
    </Table>
  );
}

export function LogsPage() {
  const { data, error, loading, refresh } = useOpsResource(
    opsApi.logs,
    "Nie udało się pobrać logów.",
  );
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");

  const query = search.trim().toLocaleLowerCase("pl");
  const logs = (data?.logs ?? []).filter(
    (entry) =>
      (level === "all" || entry.level === level) &&
      containsQuery(`${entry.message} ${entry.source} ${entry.traceId}`, query),
  );
  const audit = (data?.audit ?? []).filter((entry) =>
    containsQuery(`${entry.actor} ${entry.summary}`, query),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logi i audyt"
        description="Bufor logów bieżącego procesu oraz trwały ślad zmian administracyjnych."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
              Odśwież
            </Button>
            <Button variant="outline" asChild>
              <a href={opsApi.logExportUrl} download>
                <Download aria-hidden="true" />
                Eksportuj TSV
              </a>
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Błąd logów</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="shadow-none">
        <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Zdarzenia</CardTitle>
            <CardDescription className="mt-1.5">
              Do 500 najnowszych wpisów dostępnych w procesie i bazie.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search
                className="absolute top-2.5 left-3 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj"
                aria-label="Szukaj"
                className="pl-9 sm:w-80"
              />
            </div>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              aria-label="Poziom logów"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">Wszystkie poziomy</option>
              <option value="info">Informacje</option>
              <option value="warn">Ostrzeżenia</option>
              <option value="error">Błędy</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {loading && !data ? (
            <div
              role="status"
              className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"
            >
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Wczytywanie
            </div>
          ) : (
            <Tabs defaultValue="logs">
              <TabsList>
                <TabsTrigger value="logs">{`Logi (${logs.length})`}</TabsTrigger>
                <TabsTrigger value="audit">{`Audyt (${audit.length})`}</TabsTrigger>
              </TabsList>
              <TabsContent value="logs">
                <LogTable entries={logs} />
              </TabsContent>
              <TabsContent value="audit">
                <AuditTable entries={audit} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
