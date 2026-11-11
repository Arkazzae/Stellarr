import { useState } from "react";

import { Icon } from "@/components/icons/icon";
import { PageHeader } from "@/components/page-header";
import { Spinner } from "@/components/spinner";
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
import { t } from "@/i18n";
import { formatDateTime, lowerCase } from "@/i18n/format";
import { opsApi, type OpsAuditEntry, type OpsLogEntry } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

/** `query` must already be lower-cased with `lowerCase`. */
function containsQuery(text: string, query: string): boolean {
  return lowerCase(text).includes(query);
}

function LogLevel({ level }: { level: OpsLogEntry["level"] }) {
  if (level === "error") return <Badge variant="destructive">{t("logs.level.error")}</Badge>;
  if (level === "warn") return <Badge variant="warning">{t("logs.level.warn")}</Badge>;
  return <Badge variant="outline">{t("logs.level.info")}</Badge>;
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
          <TableHead>{t("logs.col.time")}</TableHead>
          <TableHead>{t("logs.col.level")}</TableHead>
          <TableHead>{t("logs.col.source")}</TableHead>
          <TableHead>{t("logs.col.message")}</TableHead>
          <TableHead>{t("logs.col.trace")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Entries carry no id and may share a timestamp, so rows are told apart by position. */}
        {entries.map((entry, position) => (
          <TableRow key={position}>
            <TableCell className="whitespace-nowrap font-mono text-xs">
              {formatDateTime(entry.at)}
            </TableCell>
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
        {entries.length === 0 ? <EmptyRow columns={5}>{t("logs.empty")}</EmptyRow> : null}
      </TableBody>
    </Table>
  );
}

function AuditTable({ entries }: { entries: OpsAuditEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("logs.col.time")}</TableHead>
          <TableHead>{t("logs.col.actor")}</TableHead>
          <TableHead>{t("logs.col.operation")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(entry.at)}
            </TableCell>
            <TableCell className="font-medium">{entry.actor}</TableCell>
            <TableCell>{entry.summary}</TableCell>
          </TableRow>
        ))}
        {entries.length === 0 ? <EmptyRow columns={3}>{t("logs.auditEmpty")}</EmptyRow> : null}
      </TableBody>
    </Table>
  );
}

export function LogsPage() {
  const { data, error, loading, refresh } = useOpsResource(
    opsApi.logs,
    t("logs.loadFailed"),
  );
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");

  const query = lowerCase(search.trim());
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
        title={t("logs.title")}
        description={t("logs.description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Spinner /> : null}
              {t("logs.refresh")}
            </Button>
            <Button variant="outline" asChild>
              <a href={opsApi.logExportUrl} download>
                {t("logs.export")}
              </a>
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("logs.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{t("logs.events.title")}</CardTitle>
            <CardDescription className="mt-1.5">{t("logs.events.description")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Icon name="search" className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("logs.search")}
                aria-label={t("logs.search")}
                className="pl-9 sm:w-80"
              />
            </div>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              aria-label={t("logs.levelFilter")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">{t("logs.filter.all")}</option>
              <option value="info">{t("logs.filter.info")}</option>
              <option value="warn">{t("logs.filter.warn")}</option>
              <option value="error">{t("logs.filter.error")}</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {loading && !data ? (
            <div
              role="status"
              className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"
            >
              <Spinner />
              {t("logs.loading")}
            </div>
          ) : (
            <Tabs defaultValue="logs">
              <TabsList>
                <TabsTrigger value="logs">{t("logs.tab.logs", { count: logs.length })}</TabsTrigger>
                <TabsTrigger value="audit">{t("logs.tab.audit", { count: audit.length })}</TabsTrigger>
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
