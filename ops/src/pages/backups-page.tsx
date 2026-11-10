import { DatabaseBackup, Download, LoaderCircle, Plus, ShieldCheck, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { opsApi, type OpsBackup } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

const megabytes = new Intl.NumberFormat("pl-PL", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 2,
});

const formatSize = (bytes: number) => megabytes.format(bytes / 1024 / 1024);
const formatTime = (value: string) => new Date(value).toLocaleString("pl-PL");

interface SummaryProps {
  value: string;
  label: string;
  icon?: LucideIcon;
}

function Summary({ value, label, icon: Icon }: SummaryProps) {
  return (
    <Card role="group" aria-label={label} className="py-5 shadow-none">
      <CardContent>
        {Icon ? <Icon className="mb-2 size-5 text-muted-foreground" aria-hidden="true" /> : null}
        <p className={Icon ? "font-semibold" : "text-xl font-semibold"}>{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

interface BackupRowProps {
  backup: OpsBackup;
  verifying: boolean;
  onVerify: () => void;
}

function BackupRow({ backup, verifying, onVerify }: BackupRowProps) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{backup.id}</TableCell>
      <TableCell>{formatTime(backup.createdAt)}</TableCell>
      <TableCell>{formatSize(backup.sizeBytes)}</TableCell>
      <TableCell>
        {backup.verifiedAt ? (
          <Badge variant="success">{formatTime(backup.verifiedAt)}</Badge>
        ) : (
          <Badge variant="warning">Niesprawdzony</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex gap-1">
          <Button variant="ghost" size="sm" disabled={verifying} onClick={onVerify}>
            {verifying ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck aria-hidden="true" />
            )}
            Sprawdź
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={opsApi.backupDownloadUrl(backup.id)} download aria-label={`Pobierz ${backup.id}`}>
              <Download aria-hidden="true" />
            </a>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function BackupsPage() {
  const { data, error: loadError, refresh } = useOpsResource(
    opsApi.backups,
    "Nie udało się pobrać backupów.",
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    try {
      const backup = await opsApi.createBackup();
      await refresh();
      setActionError(null);
      setNotice(`Utworzono ${backup.id}.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Nie udało się utworzyć backupu.");
    } finally {
      setCreating(false);
    }
  }

  async function verify(backup: OpsBackup) {
    setVerifyingId(backup.id);
    try {
      await opsApi.verifyBackup(backup.id);
      await refresh();
      setActionError(null);
      setNotice(`Kontrola integralności ${backup.id} zakończona powodzeniem.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Backup nie przeszedł weryfikacji.");
    } finally {
      setVerifyingId(null);
    }
  }

  const backups = data?.backups ?? [];
  // The server lists the newest backup first.
  const latest = backups[0];
  const latestVerified = backups.find((backup) => backup.verifiedAt);
  const error = actionError ?? loadError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup i odtwarzanie"
        description="Rzeczywiste kopie SQLite tworzone przez mechanizm online backup."
        actions={
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {creating ? "Tworzenie" : "Utwórz backup"}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Błąd backupu</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Gotowe</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Summary
          icon={DatabaseBackup}
          value={latest ? formatTime(latest.createdAt) : "Brak"}
          label="Ostatni backup"
        />
        <Summary
          icon={ShieldCheck}
          value={latestVerified?.verifiedAt ? formatTime(latestVerified.verifiedAt) : "Brak"}
          label="Ostatnia weryfikacja"
        />
        <Summary
          value={String(backups.length)}
          label={`Kopii · retencja ${data?.retentionDays ?? "—"} dni`}
        />
      </section>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Kopie SQLite</CardTitle>
          <CardDescription>
            Każdą kopię można sprawdzić przez PRAGMA integrity_check i pobrać jako plik bazy.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identyfikator</TableHead>
                <TableHead>Utworzono</TableHead>
                <TableHead>Rozmiar</TableHead>
                <TableHead>Weryfikacja</TableHead>
                <TableHead className="text-right">Akcje</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((backup) => (
                <BackupRow
                  key={backup.id}
                  backup={backup}
                  verifying={verifyingId === backup.id}
                  onVerify={() => void verify(backup)}
                />
              ))}
              {data && backups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                    Nie utworzono jeszcze żadnej kopii.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>Zakres kopii</AlertTitle>
        <AlertDescription>
          Backup obejmuje bazę SQLite. Obiekty z zewnętrznego storage oraz sekrety środowiskowe nie są
          kopiowane przez ten endpoint.
        </AlertDescription>
      </Alert>
    </div>
  );
}
