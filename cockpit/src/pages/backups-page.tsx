import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@stellarr/ui";
import { useEffect, useState, type FormEvent } from "react";

import { BackupSettings } from "@/components/backup-settings";
import { Icon } from "@/components/icons/icon";
import { PageHeader } from "@/components/page-header";
import { Stat, StatGrid } from "@/components/stats";
import { t, type MessageKey } from "@/i18n";
import { formatDateTime, formatMegabytes, formatNumber } from "@/i18n/format";
import {
  cockpitApi,
  type CockpitBackup,
  type CockpitBackupChoice,
  type CockpitBackupJob,
  type CockpitBackupPart,
} from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { leaveFor } from "@/lib/web-sign-in";
import { useCockpit } from "@/state/cockpit-context";

const formatSize = (bytes: number) => formatMegabytes(bytes, 2);

/** How often the list is read again while an archive is being written. */
const JOB_POLL_MS = 1500;

const PARTS: readonly CockpitBackupPart[] = ["database", "objects", "keys", "instance"];

const PART_LABEL: Record<CockpitBackupPart, MessageKey> = {
  database: "backups.part.database",
  objects: "backups.part.objects",
  keys: "backups.part.keys",
  instance: "backups.part.instance",
};

const PART_HINT: Record<CockpitBackupPart, MessageKey> = {
  database: "backups.part.databaseHint",
  objects: "backups.part.objectsHint",
  keys: "backups.part.keysHint",
  instance: "backups.part.instanceHint",
};

const EVERYTHING: CockpitBackupChoice = { database: true, objects: true, keys: true, instance: true };

function isJob(result: CockpitBackup | CockpitBackupJob): result is CockpitBackupJob {
  return "phase" in result;
}

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
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {backup.parts.map((part) => (
            <Badge key={part} variant="secondary">
              {t(PART_LABEL[part])}
            </Badge>
          ))}
          {backup.missingObjects > 0 ? (
            <Badge variant="warning">{t("backups.missing", { count: formatNumber(backup.missingObjects) })}</Badge>
          ) : null}
        </div>
      </TableCell>
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
          <Button variant="quiet" size="sm" disabled={verifying} onClick={onVerify}>
            {verifying ? <Spinner /> : null}
            {t("backups.verify")}
          </Button>
          <Button variant="quiet" size="icon-sm" asChild>
            <a
              href={cockpitApi.backupDownloadUrl(backup.id)}
              download
              aria-label={t("backups.download", { id: backup.id })}
              onClick={(event) => {
                // A download needs a recent second step; without one the
                // confirmation opens instead of a refusal saved as a file.
                event.preventDefault();
                const url = cockpitApi.backupDownloadUrl(backup.id);
                cockpitApi.checkFreshSecondStep().then(() => leaveFor(url), () => undefined);
              }}
            >
              <Icon name="download" />
            </a>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

interface CreateDialogProps {
  open: boolean;
  storedBytes: number;
  onOpenChange: (open: boolean) => void;
  onCreate: (choice: CockpitBackupChoice) => Promise<boolean>;
}

/** Picks what goes into a backup; everything is chosen to begin with. */
function CreateDialog({ open, storedBytes, onOpenChange, onCreate }: CreateDialogProps) {
  const [choice, setChoice] = useState<CockpitBackupChoice>(EVERYTHING);
  const [pending, setPending] = useState(false);
  const nothing = PARTS.every((part) => !choice[part]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nothing) return;
    setPending(true);
    const done = await onCreate(choice);
    setPending(false);
    if (done) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setChoice(EVERYTHING);
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("backups.dialog.title")}</DialogTitle>
          <DialogDescription>{t("backups.dialog.description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <fieldset className="space-y-3">
            <legend className="sr-only">{t("backups.dialog.parts")}</legend>
            {PARTS.map((part) => (
              <label key={part} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="checkbox"
                  checked={choice[part]}
                  onChange={(event) => setChoice((current) => ({ ...current, [part]: event.target.checked }))}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-medium">{t(PART_LABEL[part])}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {t(PART_HINT[part], { size: formatSize(storedBytes) })}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs leading-5 text-muted-foreground">{t("backups.dialog.environment")}</p>
          {nothing ? (
            <p role="alert" className="text-xs text-danger">
              {t("backups.dialog.nothing")}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("backups.dialog.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={nothing || pending}>
              {pending ? <Spinner /> : null}
              {t("backups.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The archive being written, with how many stored files it has taken so far. */
function JobProgress({ job }: { job: CockpitBackupJob }) {
  const share = job.objectsTotal > 0 ? job.objectsDone / job.objectsTotal : 0;
  return (
    <Card className="gap-3 px-5 py-4" role="status">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Spinner />
        {t("backups.job.title", { phase: t(PART_LABEL[job.phase]) })}
      </div>
      {job.phase === "objects" && job.objectsTotal > 0 ? (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-chart-track" aria-hidden="true">
            <div className="h-full bg-chart-1 transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t("backups.job.objects", {
              done: formatNumber(job.objectsDone),
              total: formatNumber(job.objectsTotal),
            })}
          </p>
        </>
      ) : null}
    </Card>
  );
}

export function BackupsPage() {
  const { bootstrap } = useCockpit();
  const { data, error: loadError, refresh } = useCockpitResource(
    cockpitApi.backups,
    t("backups.loadFailed"),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  // The archive this page started, to say when it is ready.
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const job = data?.job ?? null;

  // While an archive is written, the list is read again until it is done.
  useEffect(() => {
    if (!job && !data?.automation?.enabled) return;
    const timer = window.setInterval(() => void refresh(), job ? JOB_POLL_MS : 30000);
    return () => window.clearInterval(timer);
  }, [job, data?.automation?.enabled, refresh]);

  async function create(choice: CockpitBackupChoice): Promise<boolean> {
    try {
      const result = await cockpitApi.createBackup(choice);
      await refresh();
      setActionError(null);
      setStartedJobId(isJob(result) ? result.id : null);
      setNotice(isJob(result) ? null : t("backups.created", { id: result.id }));
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("backups.createFailed"));
      return false;
    }
  }

  async function verify(backup: CockpitBackup) {
    setVerifyingId(backup.id);
    try {
      await cockpitApi.verifyBackup(backup.id);
      await refresh();
      setActionError(null);
      setStartedJobId(null);
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
  const failure = !job && data?.lastFailure ? data.lastFailure : null;
  // A started archive that is no longer running either failed or is ready.
  const ready =
    startedJobId && data && !job && data.lastFailure?.id !== startedJobId
      ? t("backups.created", { id: startedJobId })
      : null;
  const shownNotice = notice ?? ready;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title={t("backups.title")}
        description={t("backups.description")}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="quiet" size="icon" aria-label={t("backups.scope.title")}>
                  <Icon name="info" size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-sm leading-5">
                {t("backups.scope.description")}
              </TooltipContent>
            </Tooltip>
            <Button variant="secondary" onClick={() => setSettingsOpen(true)}>{t("backups.settings.title")}</Button>
            <Button onClick={() => setDialogOpen(true)} disabled={job !== null}>
              {t("backups.create")}
            </Button>
          </>
        }
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent closeLabel={t("common.close")} className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("backups.settings.title")}</DialogTitle>
            <DialogDescription>{t("backups.settings.description")}</DialogDescription>
          </DialogHeader>
          {settingsOpen ? <BackupSettings onSaved={() => void refresh()} /> : null}
        </DialogContent>
      </Dialog>

      <CreateDialog
        open={dialogOpen}
        storedBytes={bootstrap?.overview.storedObjectBytes ?? 0}
        onOpenChange={setDialogOpen}
        onCreate={create}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("backups.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>{t("backups.failed", { id: failure.id })}</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      ) : null}
      {shownNotice ? (
        <Alert>
          <AlertTitle>{t("common.done")}</AlertTitle>
          <AlertDescription>{shownNotice}</AlertDescription>
        </Alert>
      ) : null}
      {job ? <JobProgress job={job} /> : null}

      {data?.automation ? (
        <Card className="gap-3 px-5 py-4">
          <p className="text-sm font-medium">{t("backups.automation.title")}</p>
          <p className="text-sm text-muted-foreground">
            {data.automation.enabled
              ? t("backups.automation.enabled", { hours: data.automation.intervalHours })
              : t("backups.automation.disabled")}
            {" "}{t(data.automation.remoteEnabled ? "backups.automation.remote" : "backups.automation.local")}
          </p>
          {data.automation.enabled ? (
            <p className="text-xs text-muted-foreground">
              {t("backups.automation.success", { date: data.automation.lastSuccessAt ? formatDateTime(data.automation.lastSuccessAt) : t("common.none") })}
              {" · "}{t("backups.automation.next", { date: data.automation.nextAttemptAt ? formatDateTime(data.automation.nextAttemptAt) : t("backups.automation.waiting") })}
            </p>
          ) : null}
          {data.automation.lastError ? <p role="alert" className="text-sm text-danger">{t("backups.automation.failed")}</p> : null}
          {data.automation.pendingBackupId ? <p role="status" className="text-xs text-muted-foreground">{t("backups.automation.pending")}</p> : null}
        </Card>
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
                <TableHead>{t("backups.col.contents")}</TableHead>
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
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                    {t("backups.empty")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}
