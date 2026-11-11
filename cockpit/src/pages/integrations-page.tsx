import { useState } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { PageHeader } from "@/components/page-header";
import { SecretField } from "@/components/secret-field";
import { Spinner } from "@/components/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { cockpitApi, type CockpitSecret, type CockpitSettings } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";

interface Notice {
  message: string;
  error: boolean;
}

/** Resend, the one integration so far: it replaces SMTP for outgoing mail while it is on. */
function ResendCard({
  settings,
  apiKey,
  saving,
  onToggle,
  onSecretChanged,
}: {
  settings: CockpitSettings;
  apiKey: CockpitSecret | null;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onSecretChanged: () => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardTitleRow icon="send" title="Resend">
        <Badge variant={settings.resendEnabled ? "success" : "outline"}>
          {settings.resendEnabled ? t("integrations.active") : t("integrations.inactive")}
        </Badge>
      </CardTitleRow>
      <div className="space-y-5 px-5 py-5">
        <p className="text-sm text-muted-foreground">{t("integrations.resend.description")}</p>
        <SecretField title={t("integrations.resend.key")} secret={apiKey} onChanged={onSecretChanged} />
        <div className="flex items-start justify-between gap-6 border-t pt-5">
          <div>
            <Label htmlFor="resend-enabled">{t("integrations.resend.toggle")}</Label>
            <p id="resend-enabled-description" className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("integrations.resend.toggleDescription")}
            </p>
          </div>
          <Switch
            id="resend-enabled"
            checked={settings.resendEnabled}
            onCheckedChange={onToggle}
            aria-describedby="resend-enabled-description"
            disabled={saving}
          />
        </div>
        <p className="border-t pt-5 text-xs text-muted-foreground">{t("integrations.resend.testHint")}</p>
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const { data, error, loading, refresh } = useCockpitResource(cockpitApi.settings, t("integrations.loadFailed"));
  const secrets = useCockpitResource(cockpitApi.secrets, t("secret.loadFailed"));
  const [saving, setSaving] = useState(false);
  const secret = (name: CockpitSecret["name"]) => secrets.data?.find((item) => item.name === name) ?? null;

  // A key changes whether mail is ready, so the settings are read again with it.
  function secretChanged() {
    void Promise.all([refresh(), secrets.refresh()]);
  }
  const [notice, setNotice] = useState<Notice | null>(null);

  async function setResend(enabled: boolean) {
    if (!data) return;
    setSaving(true);
    setNotice(null);
    try {
      await cockpitApi.updateSettings({ ...data, resendEnabled: enabled });
      await refresh();
      setNotice({ message: enabled ? t("integrations.resend.on") : t("integrations.resend.off"), error: false });
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
              onToggle={(enabled) => void setResend(enabled)}
              onSecretChanged={secretChanged}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
