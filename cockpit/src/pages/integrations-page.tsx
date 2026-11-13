import { useState } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { CloudflareSettings } from "@/components/cloudflare-settings";
import { PageHeader } from "@/components/page-header";
import { SecretField } from "@/components/secret-field";
import { Spinner } from "@/components/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { cockpitApi, type CockpitIntegrationSwitches, type CockpitSecret, type CockpitSettings } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

interface Notice {
  message: string;
  error: boolean;
}

function StateBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "success" : "outline"}>
      {active ? t("integrations.active") : t("integrations.inactive")}
    </Badge>
  );
}

interface SwitchRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function SwitchRow({ id, label, description, checked, disabled, onCheckedChange }: SwitchRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 border-t pt-5">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-description`} className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-description`}
        disabled={disabled}
      />
    </div>
  );
}

interface CardProps {
  settings: CockpitSettings;
  apiKey: CockpitSecret | null;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onSecretChanged: () => void;
}

/** Resend replaces SMTP for outgoing mail while it is on. */
function ResendCard({ settings, apiKey, saving, onToggle, onSecretChanged }: CardProps) {
  return (
    <Card className="gap-0 py-0">
      <CardTitleRow icon="send" title="Resend">
        <StateBadge active={settings.resendEnabled} />
      </CardTitleRow>
      <div className="space-y-5 px-5 py-5">
        <p className="text-sm text-muted-foreground">{t("integrations.resend.description")}</p>
        <SecretField title={t("integrations.resend.key")} secret={apiKey} onChanged={onSecretChanged} />
        <SwitchRow
          id="resend-enabled"
          label={t("integrations.resend.toggle")}
          description={t("integrations.resend.toggleDescription")}
          checked={settings.resendEnabled}
          disabled={saving}
          onCheckedChange={onToggle}
        />
        <p className="border-t pt-5 text-xs text-muted-foreground">{t("integrations.resend.testHint")}</p>
      </div>
    </Card>
  );
}

type Check = { state: "idle" } | { state: "checking" } | { state: "done"; ok: boolean; message: string };

/** GIPHY powers the GIF search in the web client's message field. */
function GiphyCard({ settings, apiKey, saving, onToggle, onSecretChanged }: CardProps) {
  const [check, setCheck] = useState<Check>({ state: "idle" });

  async function runCheck() {
    setCheck({ state: "checking" });
    try {
      await cockpitApi.testGiphy();
      setCheck({ state: "done", ok: true, message: t("integrations.giphy.connected") });
    } catch (cause) {
      setCheck({
        state: "done",
        ok: false,
        message: cause instanceof Error ? cause.message : t("integrations.giphy.checkFailed"),
      });
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardTitleRow icon="smiley" title="GIPHY">
        <StateBadge active={settings.giphyEnabled} />
      </CardTitleRow>
      <div className="space-y-5 px-5 py-5">
        <p className="text-sm text-muted-foreground">{t("integrations.giphy.description")}</p>
        <SecretField
          title={t("integrations.giphy.key")}
          secret={apiKey}
          onChanged={() => {
            setCheck({ state: "idle" });
            onSecretChanged();
          }}
        />
        <div className="space-y-2 border-t pt-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">{t("integrations.giphy.checkDescription")}</p>
            <Button
              type="button"
              variant="outline"
              disabled={!settings.giphyKeyConfigured || check.state === "checking"}
              onClick={() => void runCheck()}
            >
              {check.state === "checking" ? <Spinner /> : null}
              {t("integrations.giphy.check")}
            </Button>
          </div>
          {check.state === "done" ? (
            <p role={check.ok ? "status" : "alert"} className={check.ok ? "text-sm text-success" : "text-sm text-danger"}>
              {check.message}
            </p>
          ) : null}
        </div>
        <SwitchRow
          id="giphy-enabled"
          label={t("integrations.giphy.toggle")}
          description={
            settings.giphyKeyConfigured
              ? t("integrations.giphy.toggleDescription")
              : t("integrations.giphy.toggleNeedsKey")
          }
          checked={settings.giphyEnabled}
          disabled={saving || !settings.giphyKeyConfigured}
          onCheckedChange={onToggle}
        />
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const { data, error, loading, refresh } = useCockpitResource(cockpitApi.settings, t("integrations.loadFailed"));
  const secrets = useCockpitResource(cockpitApi.secrets, t("secret.loadFailed"));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const secret = (name: CockpitSecret["name"]) => secrets.data?.find((item) => item.name === name) ?? null;

  // A key changes whether an integration can work, so the settings are read again with it.
  function secretChanged() {
    void Promise.all([refresh(), secrets.refresh()]);
  }

  async function save(change: CockpitIntegrationSwitches, done: string) {
    if (!data) return;
    setSaving(true);
    setNotice(null);
    try {
      await cockpitApi.updateSettings(data, change);
      await refresh();
      setNotice({ message: done, error: false });
    } catch (cause) {
      setNotice({ message: cause instanceof Error ? cause.message : t("integrations.saveFailed"), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader title={t("integrations.title")} description={t("integrations.description")} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("integrations.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant={notice.error ? "destructive" : "default"}>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      {!data && loading ? (
        <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t("integrations.loading")}
        </div>
      ) : null}

      {data ? (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <ResendCard
              settings={data}
              apiKey={secret("mail.resend-api-key")}
              saving={saving}
              onToggle={(enabled) =>
                void save(
                  { resendEnabled: enabled },
                  enabled ? t("integrations.resend.on") : t("integrations.resend.off"),
                )
              }
              onSecretChanged={secretChanged}
            />
            <GiphyCard
              settings={data}
              apiKey={secret("giphy.api-key")}
              saving={saving}
              onToggle={(enabled) =>
                void save(
                  { giphyEnabled: enabled },
                  enabled ? t("integrations.giphy.on") : t("integrations.giphy.off"),
                )
              }
              onSecretChanged={secretChanged}
            />
            <CloudflareSettings secrets={secrets.data ?? []} onSecretChanged={secretChanged} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
