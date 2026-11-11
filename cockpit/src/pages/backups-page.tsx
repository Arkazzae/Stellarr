import { useState } from "react";

import { Icon } from "@/components/icons/icon";
import { Spinner } from "@/components/spinner";
import { PageHeader } from "@/components/page-header";
import { Stat, StatGrid } from "@/components/stats";
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
import { t } from "@/i18n";
import { formatDateTime, formatMegabytes } from "@/i18n/format";
import { cockpitApi, type CockpitBackup } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

const formatSize = (bytes: number) => formatMegabytes(bytes, 2);

interface BackupRowProps {
  backup: CockpitBackup;
  verifying: boolean;
  onVerify: () => void;
}

function BackupRow({ backup, verifying, onVerify }: BackupRowProps) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{backup.id}</TableCell>
      <TableCell>{formatDateTime(backup.createdAt)}</TableCell>
      <TableCell>{formatSize(backup.sizeBytes)}</TableCell>
      <TableCell>
        {backup.verifiedAt ? (
          <Badge variant="success">{formatDateTime(backup.verifiedAt)}</Badge>
        ) : (
          <Badge variant="warning">{t("backups.unverified")}</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex gap-1">
          <Button variant="ghost" size="sm" disabled={verifying} onClick={onVerify}>
            {verifying ? <Spinner /> : null}
            {t("backups.verify")}
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={cockpitApi.backupDownloadUrl(backup.id)} download aria-label={t("backups.download", { id: backup.id })}>
              <Icon name="download" />
            </a>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function BackupsPage() {
  const { data, error: loadError, refresh } = useCockpitResource(
    cockpitApi.backups,
    t("backups.loadFailed"),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    try {
      const backup = await cockpitApi.createBackup();
      await refresh();
      setActionError(null);
      setNotice(t("backups.created", { id: backup.id }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("backups.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function verify(backup: CockpitBackup) {
    setVerifyingId(backup.id);
    try {
      await cockpitApi.verifyBackup(backup.id);
      await refresh();
      setActionError(null);
      setNotice(t("backups.verified", { id: backup.id }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("backups.verifyFailed"));
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
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title={t("backups.title")}
        description={t("backups.description")}
        actions={
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? <Spinner /> : null}
            {creating ? t("common.creating") : t("backups.create")}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("backups.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>{t("common.done")}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <StatGrid className="sm:grid-cols-3">
        <Stat
          label={t("backups.summary.latest")}
          value={latest ? formatDateTime(latest.createdAt) : t("common.none")}
        />
        <Stat
          label={t("backups.summary.latestVerification")}
          value={
            latestVerified?.verifiedAt ? formatDateTime(latestVerified.verifiedAt) : t("common.none")
          }
        />
        <Stat
          label={t("backups.summary.count", { days: data?.retentionDays ?? "—" })}
          value={String(backups.length)}
        />
      </StatGrid>

      <Card className="min-h-0 flex-1">
        <CardHeader>
          <CardTitle>{t("backups.table.title")}</CardTitle>
          <CardDescription>{t("backups.table.description")}</CardDescription>
        </CardHeader>
        <CardContent className="relative min-h-0 flex-1 overflow-auto px-4 sm:px-6">
          <Table containerClassName="overflow-visible">
            <TableHeader>
              <TableRow>
                <TableHead>{t("backups.col.id")}</TableHead>
                <TableHead>{t("backups.col.created")}</TableHead>
                <TableHead>{t("backups.col.size")}</TableHead>
                <TableHead>{t("backups.col.verification")}</TableHead>
                <TableHead className="text-right">{t("backups.col.actions")}</TableHead>
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
                    {t("backups.empty")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>{t("backups.scope.title")}</AlertTitle>
        <AlertDescription>{t("backups.scope.description")}</AlertDescription>
      </Alert>
    </div>
  );
}
