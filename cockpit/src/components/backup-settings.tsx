import { useState, type FormEvent } from "react";

import { SecretField } from "@/components/secret-field";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { t, type MessageKey } from "@/i18n";
import { CockpitApiError, cockpitApi, type CockpitBackupSettings, type CockpitSecret } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

const NUMBERS: { name: "intervalHours" | "retryMinutes" | "initialDelayMinutes" | "retentionDays"; label: MessageKey; min: number; max: number }[] = [
  { name: "intervalHours", label: "backups.settings.interval", min: 1, max: 8760 },
  { name: "retryMinutes", label: "backups.settings.retry", min: 1, max: 1440 },
  { name: "initialDelayMinutes", label: "backups.settings.delay", min: 0, max: 1440 },
  { name: "retentionDays", label: "backups.settings.retention", min: 1, max: 3650 },
];
const DESTINATION: { name: "endpoint" | "region" | "bucket" | "prefix"; label: MessageKey; max: number }[] = [
  { name: "endpoint", label: "backups.settings.endpoint", max: 2048 },
  { name: "region", label: "backups.settings.region", max: 100 },
  { name: "bucket", label: "backups.settings.bucket", max: 255 },
  { name: "prefix", label: "backups.settings.prefix", max: 512 },
];

function failureMessage(cause: unknown): string {
  if (cause instanceof CockpitApiError) {
    const details = Object.values(cause.errors).flat().join(" ");
    if (details) return details;
  }
  return cause instanceof Error ? cause.message : t("backups.settings.failed");
}

function PolicyForm({ initial, secrets, onSaved, onSecretChanged }: {
  initial: CockpitBackupSettings;
  secrets: CockpitSecret[];
  onSaved: () => void;
  onSecretChanged: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  function change<K extends keyof CockpitBackupSettings>(name: K, value: CockpitBackupSettings[K]) {
    setForm((current) => ({ ...current, [name]: value }));
    setSaved(false);
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setForm(await cockpitApi.updateBackupSettings(form));
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(failureMessage(cause));
    } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setForm(await cockpitApi.resetBackupSettings());
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(failureMessage(cause));
    } finally { setBusy(false); }
  }
  return (
    <form className="space-y-5" onSubmit={(event) => void save(event)}>
      <p className="text-sm text-muted-foreground">{t(form.source === "panel" ? "backups.settings.panel" : "backups.settings.environment")}</p>
      <fieldset disabled={busy} className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="backup-enabled">{t("backups.settings.enabled")}</Label>
          <Switch id="backup-enabled" checked={form.enabled} onCheckedChange={(value) => change("enabled", value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBERS.map(({ name, label, min, max }) => (
            <div key={name} className="space-y-2">
              <Label htmlFor={`backup-${name}`}>{t(label)}</Label>
              <Input id={`backup-${name}`} type="number" min={min} max={max} step={1} required value={Number.isFinite(form[name]) ? form[name] : ""}
                onChange={(event) => change(name, event.target.valueAsNumber)} />
            </div>
          ))}
        </div>
        {!form.cleanupEnabled ? <p role="note" className="text-sm text-danger">{t("backups.settings.cleanup")}</p> : null}
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <Label htmlFor="backup-remote">{t("backups.settings.remote")}</Label>
          <Switch id="backup-remote" checked={form.remoteEnabled} onCheckedChange={(value) => change("remoteEnabled", value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {DESTINATION.map(({ name, label, max }) => (
            <div key={name} className="space-y-2">
              <Label htmlFor={`backup-${name}`}>{t(label)}</Label>
              <Input id={`backup-${name}`} type={name === "endpoint" ? "url" : "text"} maxLength={max}
                required={form.remoteEnabled} value={form[name]} placeholder={name === "endpoint" ? "https://ACCOUNT_ID.r2.cloudflarestorage.com" : undefined}
                onChange={(event) => change(name, event.target.value)} />
            </div>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t("backups.settings.cloudPolicies")}</p>
      </fieldset>
      <SecretField title={t("backups.settings.accessKey")} secret={secrets.find((item) => item.name === "backups.access-key") ?? null} onChanged={onSecretChanged} />
      <SecretField title={t("backups.settings.secretKey")} secret={secrets.find((item) => item.name === "backups.secret-key") ?? null} onChanged={onSecretChanged} />
      <p className="text-xs leading-5 text-muted-foreground">{t("backups.settings.credentialsHint")}</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-success">{t("backups.settings.saved")}</p> : null}
      <p className="text-xs leading-5 text-muted-foreground">{t("backups.settings.resetHint")}</p>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
        <Button type="button" variant="ghost" disabled={busy || form.source !== "panel"} onClick={() => void reset()}>{t("backups.settings.reset")}</Button>
        <Button type="submit" disabled={busy}>{busy ? <Spinner /> : null}{t("backups.settings.save")}</Button>
      </div>
    </form>
  );
}

export function BackupSettings({ onSaved }: { onSaved: () => void }) {
  const settings = useCockpitResource(cockpitApi.backupSettings, t("backups.settings.failed"));
  const secrets = useCockpitResource(cockpitApi.secrets, t("secret.loadFailed"));
  if (settings.error || secrets.error) return <p role="alert" className="text-sm text-danger">{settings.error ?? secrets.error}</p>;
  if (!settings.data || !secrets.data) return <div role="status"><Spinner /></div>;
  return <PolicyForm initial={settings.data} secrets={secrets.data} onSaved={onSaved} onSecretChanged={() => void secrets.refresh()} />;
}
