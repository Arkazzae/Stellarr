import { Check, KeyRound, LoaderCircle, Mail, Save, Send, Server, ShieldCheck } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OpsApiError, opsApi, type OpsSettings } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";
import { useOps } from "@/state/ops-context";

type FieldErrors = Record<string, string[]>;
type Update = <K extends keyof OpsSettings>(key: K, value: OpsSettings[K]) => void;

interface SectionProps {
  icon: typeof Server;
  title: string;
  description: string;
  children: ReactNode;
}

function Section({ icon: Icon, title, description, children }: SectionProps) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1.5">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

interface FieldProps extends Omit<ComponentProps<typeof Input>, "id"> {
  id: string;
  label: string;
  hint?: string;
  /** The server's messages for this field; the first one is shown. */
  errors?: string[];
}

function Field({ id, label, hint, errors, ...input }: FieldProps) {
  const error = errors?.[0];
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={Boolean(error)} {...input} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface ToggleProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

function SettingToggle({ id, title, description, checked, onCheckedChange, disabled }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-6 border-b py-4 last:border-b-0">
      <div>
        <Label htmlFor={id}>{title}</Label>
        <p id={`${id}-description`} className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
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
  settings: OpsSettings;
  update: Update;
  errors: FieldErrors;
}

function InstanceCard({ settings, update, errors }: CardProps) {
  return (
    <Section
      icon={Server}
      title="Instancja"
      description="Nazwa, publiczny adres i czas używany w zadaniach."
    >
      <Field
        id="instance-name"
        label="Nazwa instancji"
        value={settings.instanceName}
        onChange={(event) => update("instanceName", event.target.value)}
        errors={errors.instanceName}
      />
      <Field
        id="public-url"
        label="Publiczny adres"
        type="url"
        value={settings.publicUrl}
        onChange={(event) => update("publicUrl", event.target.value)}
        placeholder="https://stellarr.example.net"
        hint="Używany w zaproszeniach i wiadomościach systemowych."
        errors={errors.publicUrl}
      />
      <Field
        id="timezone"
        label="Strefa czasowa serwera"
        value={settings.timeZone}
        onChange={(event) => update("timeZone", event.target.value)}
        placeholder="Europe/Warsaw"
        errors={errors.timeZone}
      />
    </Section>
  );
}

type RetentionKey = "backupRetentionDays" | "logRetentionDays" | "orphanObjectRetentionDays";

function RetentionField({
  id,
  label,
  field,
  settings,
  update,
  errors,
}: CardProps & { id: string; label: string; field: RetentionKey }) {
  return (
    <Field
      id={id}
      label={label}
      type="number"
      min={1}
      max={3650}
      value={settings[field]}
      onChange={(event) => update(field, Number(event.target.value))}
      errors={errors[field]}
    />
  );
}

function RetentionCard(props: CardProps) {
  const { settings, update } = props;
  return (
    <Section
      icon={ShieldCheck}
      title="Retencja danych"
      description="Limity są zapisywane już teraz; zadania sprzątające powstaną osobno."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <RetentionField {...props} id="backup-days" label="Backupy, dni" field="backupRetentionDays" />
        <RetentionField {...props} id="log-days" label="Logi, dni" field="logRetentionDays" />
        <RetentionField
          {...props}
          id="orphan-days"
          label="Obiekty, dni"
          field="orphanObjectRetentionDays"
        />
      </div>
      <div className="rounded-lg border px-4">
        <SettingToggle
          id="auto-cleanup"
          title="Automatyczne sprzątanie"
          description="Włącza okresowe usuwanie przeterminowanych backupów, logów i osieroconych obiektów."
          checked={settings.automaticCleanupEnabled}
          onCheckedChange={(checked) => update("automaticCleanupEnabled", checked)}
        />
      </div>
    </Section>
  );
}

function MailCard({ settings, update, errors }: CardProps) {
  return (
    <Section
      icon={Mail}
      title="Resend"
      description="Wiadomości transakcyjne przez HTTPS API, bez konfiguracji SMTP."
    >
      <div className="rounded-lg border px-4">
        <SettingToggle
          id="mail-enabled"
          title="Włącz mailing"
          description="Pozwala wysyłać linki odzyskiwania, zaproszenia i testy dostarczenia."
          checked={settings.mailingEnabled}
          onCheckedChange={(checked) => update("mailingEnabled", checked)}
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Transport</p>
          <p className="mt-1 text-sm text-muted-foreground">api.resend.com przez szyfrowane HTTPS</p>
        </div>
        <Badge variant="secondary">Resend API</Badge>
      </div>
      <Field
        id="mail-from"
        label="Adres nadawcy"
        type="email"
        value={settings.mailFromAddress}
        onChange={(event) => update("mailFromAddress", event.target.value)}
        disabled={!settings.mailingEnabled}
        placeholder="stellarr@example.net"
        hint="Użyj onboarding@resend.dev do testów albo adresu ze zweryfikowanej domeny."
        errors={errors.mailFromAddress}
      />
    </Section>
  );
}

function TestMail({ settings }: { settings: OpsSettings }) {
  const [recipient, setRecipient] = useState("delivered+stellarr@resend.dev");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setResult(null);
    setFailure(null);
    try {
      const { id } = await opsApi.sendTestMail(recipient.trim());
      setResult(`Resend przyjął wiadomość. ID: ${id}`);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Nie udało się wysłać wiadomości testowej.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <Label htmlFor="test-recipient">Odbiorca testu</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Adres Resend poniżej bezpiecznie symuluje poprawne dostarczenie.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="test-recipient"
          type="email"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          disabled={sending || !settings.mailingEnabled}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void send()}
          disabled={
            sending || !settings.mailingEnabled || !settings.resendApiKeyConfigured || !recipient.trim()
          }
        >
          {sending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {sending ? "Wysyłanie" : "Wyślij test"}
        </Button>
      </div>
      {result ? (
        <p className="text-xs text-emerald-700" role="status">
          {result}
        </p>
      ) : null}
      {failure ? (
        <p className="text-xs text-destructive" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

function DeliveryCard({ settings, update }: Omit<CardProps, "errors">) {
  const mailOff = !settings.mailingEnabled;
  return (
    <Section
      icon={KeyRound}
      title="Klucz i test dostarczenia"
      description="Sekret Resend nigdy nie wraca do przeglądarki ani do SQLite."
    >
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Klucz API</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Ustaw jako <code className="rounded bg-muted px-1 py-0.5 text-xs">Mail__ResendApiKey</code>{" "}
            w środowisku backendu.
          </p>
        </div>
        <Badge variant={settings.resendApiKeyConfigured ? "success" : "warning"}>
          {settings.resendApiKeyConfigured ? "Skonfigurowany" : "Brak sekretu"}
        </Badge>
      </div>
      <TestMail settings={settings} />
      <div className="rounded-lg border px-4">
        <SettingToggle
          id="invite-mail"
          title="Zaproszenia"
          description="Wiadomości z linkiem do utworzenia konta."
          checked={settings.inviteMailEnabled}
          onCheckedChange={(checked) => update("inviteMailEnabled", checked)}
          disabled={mailOff}
        />
        <SettingToggle
          id="recovery-mail"
          title="Odzyskiwanie konta"
          description="Bezpieczne linki do zmiany hasła."
          checked={settings.recoveryMailEnabled}
          onCheckedChange={(checked) => update("recoveryMailEnabled", checked)}
          disabled={mailOff}
        />
        <SettingToggle
          id="alert-mail"
          title="Alerty operacyjne"
          description="Informacje o niedostępności i nieudanych zadaniach."
          checked={settings.alertMailEnabled}
          onCheckedChange={(checked) => update("alertMailEnabled", checked)}
          disabled={mailOff}
        />
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const { reload } = useOps();
  const { data, error: loadError } = useOpsResource(opsApi.settings, "Nie udało się pobrać ustawień.");
  // What the server last stored, once a save has returned it, and the edits made since.
  const [stored, setStored] = useState<OpsSettings | null>(null);
  const [edits, setEdits] = useState<Partial<OpsSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const base = stored ?? data;
  const settings = base ? { ...base, ...edits } : null;

  const update: Update = (key, value) => {
    setEdits((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setSaveError(null);
    setFieldErrors({});
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setFieldErrors({});
    try {
      setStored(await opsApi.updateSettings(settings));
      setEdits({});
      setSaved(true);
      await reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Nie udało się zapisać ustawień.");
      if (cause instanceof OpsApiError) setFieldErrors(cause.errors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ustawienia instancji"
        description="Konfiguracja zapisywana przez chroniony kontrakt właściciela. Sekrety pozostają w środowisku serwera."
        actions={
          <Button type="submit" form="ops-settings-form" disabled={!settings || saving}>
            {saving ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {saving ? "Zapisywanie" : "Zapisz ustawienia"}
          </Button>
        }
      />

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Nie udało się pobrać ustawień</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive">
          <AlertTitle>Ustawienia nie zostały zapisane</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <Check aria-hidden="true" />
          <AlertTitle>Ustawienia zapisane</AlertTitle>
          <AlertDescription>
            Backend zapisał konfigurację instancji i odświeżył dane panelu.
          </AlertDescription>
        </Alert>
      ) : null}

      {!settings && !loadError ? (
        <div
          role="status"
          className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Wczytywanie ustawień
        </div>
      ) : null}

      {settings ? (
        <form
          id="ops-settings-form"
          onSubmit={(event) => void save(event)}
          className="grid items-start gap-6 lg:grid-cols-2"
        >
          <div className="space-y-6">
            <InstanceCard settings={settings} update={update} errors={fieldErrors} />
            <RetentionCard settings={settings} update={update} errors={fieldErrors} />
          </div>
          <div className="space-y-6">
            <MailCard settings={settings} update={update} errors={fieldErrors} />
            <DeliveryCard settings={settings} update={update} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
