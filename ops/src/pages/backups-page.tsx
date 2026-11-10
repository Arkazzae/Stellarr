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
import { t } from "@/i18n";
import { formatDateTime, formatMegabytes } from "@/i18n/format";
import { opsApi, type OpsBackup } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

const formatSize = (bytes: number) => formatMegabytes(bytes, 2);

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
            {verifying ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck aria-hidden="true" />
            )}
            {t("backups.verify")}
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={opsApi.backupDownloadUrl(backup.id)} download aria-label={t("backups.download", { id: backup.id })}>
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
    t("backups.loadFailed"),
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
      setNotice(t("backups.created", { id: backup.id }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("backups.createFailed"));
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
    <div className="space-y-6">
      <PageHeader
        title={t("backups.title")}
        description={t("backups.description")}
        actions={
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
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

      <section className="grid gap-4 sm:grid-cols-3">
        <Summary
          icon={DatabaseBackup}
          value={latest ? formatDateTime(latest.createdAt) : t("common.none")}
          label={t("backups.summary.latest")}
        />
        <Summary
          icon={ShieldCheck}
          value={
            latestVerified?.verifiedAt ? formatDateTime(latestVerified.verifiedAt) : t("common.none")
          }
          label={t("backups.summary.latestVerification")}
        />
        <Summary
          value={String(backups.length)}
          label={t("backups.summary.count", { days: data?.retentionDays ?? "—" })}
        />
      </section>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>{t("backups.table.title")}</CardTitle>
          <CardDescription>{t("backups.table.description")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <Table>
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
