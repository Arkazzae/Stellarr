import { Badge, Button, Card, Input, Label, Spinner, Switch } from "@stellarr/ui";
import { useState, type FormEvent } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { SecretField } from "@/components/secret-field";
import { t, type MessageKey } from "@/i18n";
import { CockpitApiError, cockpitApi, type CockpitCloudflareR2Settings, type CockpitSecret } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

const S3_FIELDS: { name: "region" | "bucket"; label: MessageKey; max: number }[] = [
  { name: "region", label: "integrations.cloudflare.region", max: 100 },
  { name: "bucket", label: "integrations.cloudflare.bucket", max: 255 },
];

const MODES: { value: CockpitCloudflareR2Settings["mode"]; labelKey: MessageKey }[] = [
  { value: "s3", labelKey: "integrations.cloudflare.mode.s3" },
  { value: "worker", labelKey: "integrations.cloudflare.mode.worker" },
];

function failureMessage(cause: unknown): string {
  if (cause instanceof CockpitApiError) {
    const details = Object.values(cause.errors).flat().join(" ");
    if (details) return details;
  }
  return cause instanceof Error ? cause.message : t("integrations.cloudflare.failed");
}

function ConnectionForm({ initial, secrets, onSecretChanged }: {
  initial: CockpitCloudflareR2Settings;
  secrets: CockpitSecret[];
  onSecretChanged: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const secret = (name: CockpitSecret["name"]) => secrets.find((item) => item.name === name) ?? null;
  const worker = form.mode === "worker";

  function change<K extends keyof CockpitCloudflareR2Settings>(name: K, value: CockpitCloudflareR2Settings[K]) {
    setForm((current) => ({ ...current, [name]: value }));
    setSaved(false);
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setForm(await cockpitApi.updateCloudflareR2(form));
      setSaved(true);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setForm(await cockpitApi.resetCloudflareR2());
      setSaved(true);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally { setBusy(false); }
  }

  return (
    <Card className="gap-0 py-0 lg:col-span-2">
      <CardTitleRow icon="server" title={t("integrations.cloudflare.title")}>
        <Badge variant={form.enabled ? "success" : "outline"}>
          {form.enabled ? t("integrations.active") : t("integrations.inactive")}
        </Badge>
      </CardTitleRow>
      <form className="space-y-5 px-5 py-5" onSubmit={(event) => void save(event)}>
        <p className="text-sm text-muted-foreground">{t("integrations.cloudflare.description")}</p>
        <p className="text-sm text-muted-foreground">
          {t(form.source === "panel" ? "integrations.cloudflare.panel" : "integrations.cloudflare.environment")}
        </p>
        <fieldset disabled={busy} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="cloudflare-r2-mode">{t("integrations.cloudflare.mode")}</Label>
            <select
              id="cloudflare-r2-mode"
              value={form.mode}
              onChange={(event) => change("mode", event.target.value as CockpitCloudflareR2Settings["mode"])}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {MODES.map(({ value, labelKey }) => (
                <option key={value} value={value}>
                  {t(labelKey)}
                </option>
              ))}
            </select>
            <p className="text-xs leading-5 text-muted-foreground">
              {t(worker ? "integrations.cloudflare.mode.workerHint" : "integrations.cloudflare.mode.s3Hint")}
            </p>
          </div>
          <div className="flex items-start justify-between gap-6 border-t pt-5">
            <div>
              <Label htmlFor="cloudflare-r2-enabled">{t("integrations.cloudflare.enabled")}</Label>
              <p id="cloudflare-r2-enabled-description" className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("integrations.cloudflare.enabledDescription")}
              </p>
            </div>
            <Switch
              id="cloudflare-r2-enabled"
              checked={form.enabled}
              onCheckedChange={(value) => change("enabled", value)}
              aria-describedby="cloudflare-r2-enabled-description"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cloudflare-r2-endpoint">
                {t(worker ? "integrations.cloudflare.workerEndpoint" : "integrations.cloudflare.endpoint")}
              </Label>
              <Input
                id="cloudflare-r2-endpoint"
                type="url"
                maxLength={2048}
                required={form.enabled}
                value={form.endpoint}
                placeholder={worker
                  ? "https://stellarr-backup-relay.ACCOUNT.workers.dev"
                  : "https://ACCOUNT_ID.r2.cloudflarestorage.com"}
                onChange={(event) => change("endpoint", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloudflare-r2-prefix">{t("integrations.cloudflare.prefix")}</Label>
              <Input
                id="cloudflare-r2-prefix"
                type="text"
                maxLength={512}
                required={form.enabled}
                value={form.prefix}
                onChange={(event) => change("prefix", event.target.value)}
              />
            </div>
            {!worker ? S3_FIELDS.map(({ name, label, max }) => (
              <div key={name} className="space-y-2">
                <Label htmlFor={`cloudflare-r2-${name}`}>{t(label)}</Label>
                <Input
                  id={`cloudflare-r2-${name}`}
                  type="text"
                  maxLength={max}
                  required={form.enabled}
                  value={form[name]}
                  onChange={(event) => change(name, event.target.value)}
                />
              </div>
            )) : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("integrations.cloudflare.cloudPolicies")}</p>
        </fieldset>
        {worker ? (
          <SecretField
            title={t("integrations.cloudflare.workerToken")}
            secret={secret("cloudflare.r2.worker-token")}
            onChanged={onSecretChanged}
          />
        ) : (
          <>
            <SecretField
              title={t("integrations.cloudflare.accessKey")}
              secret={secret("cloudflare.r2.access-key")}
              onChanged={onSecretChanged}
            />
            <SecretField
              title={t("integrations.cloudflare.secretKey")}
              secret={secret("cloudflare.r2.secret-key")}
              onChanged={onSecretChanged}
            />
          </>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          {t(worker ? "integrations.cloudflare.workerHint" : "integrations.cloudflare.credentialsHint")}
        </p>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        {saved ? <p role="status" className="text-sm text-success">{t("integrations.cloudflare.saved")}</p> : null}
        <p className="text-xs leading-5 text-muted-foreground">{t("integrations.cloudflare.resetHint")}</p>
        <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
          <Button type="button" variant="quiet" disabled={busy || form.source !== "panel"} onClick={() => void reset()}>
            {t("integrations.cloudflare.reset")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            {t("integrations.cloudflare.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function CloudflareSettings({ secrets, onSecretChanged }: {
  secrets: CockpitSecret[];
  onSecretChanged: () => void;
}) {
  const settings = useCockpitResource(cockpitApi.cloudflareR2, t("integrations.cloudflare.failed"));
  if (settings.error) return <p role="alert" className="text-sm text-danger">{settings.error}</p>;
  if (!settings.data) return <Card className="lg:col-span-2"><div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />{t("integrations.loading")}</div></Card>;
  return (
    <ConnectionForm
      initial={settings.data}
      secrets={secrets}
      onSecretChanged={onSecretChanged}
    />
  );
}
