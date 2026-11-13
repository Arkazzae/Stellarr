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
  Dropdown,
  type DropdownOption,
  Input,
  Label,
  Segmented,
  Spinner,
  Switch,
} from "@stellarr/ui";
import { useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SecretField } from "@/components/secret-field";
import { LOCALES, t, type Locale, type MessageKey } from "@/i18n";
import {
  CockpitApiError,
  cockpitApi,
  type CockpitMfaRequirement,
  type CockpitSecret,
  type CockpitSecurityChanges,
  type CockpitSecurityKey,
  type CockpitSettings,
  type CockpitSmtpSecurity,
} from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { useCockpit } from "@/state/cockpit-context";
import { useLocale } from "@/state/locale-context";

type FieldErrors = Record<string, string[]>;
/** Edits the settings the page's button saves; the security card keeps its own changes. */
type Update = <K extends Exclude<keyof CockpitSettings, CockpitSecurityKey>>(key: K, value: CockpitSettings[K]) => void;
type SecurityUpdate = <K extends CockpitSecurityKey>(key: K, value: CockpitSettings[K]) => void;

interface SectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
      {error ? <p className="text-xs text-danger">{error}</p> : null}
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
  settings: CockpitSettings;
  update: Update;
  errors: FieldErrors;
}

/** Each language named in itself, so it can be found whatever the panel shows now. */
const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", pl: "Polski" };

const LANGUAGE_OPTIONS: readonly DropdownOption<Locale>[] = LOCALES.map((locale) => ({
  value: locale,
  label: LANGUAGE_NAMES[locale],
  lang: locale,
}));

/** The panel's own language: applied at once and kept in this browser, apart from the saved settings. */
function LanguageCard() {
  const { locale, changeLocale } = useLocale();
  return (
    <Section title={t("settings.language.title")} description={t("settings.language.description")}>
      <div className="space-y-2">
        <Label htmlFor="panel-language">{t("settings.language.label")}</Label>
        <Dropdown id="panel-language" options={LANGUAGE_OPTIONS} value={locale} onChange={changeLocale} />
      </div>
    </Section>
  );
}

function InstanceCard({ settings, update, errors }: CardProps) {
  return (
    <Section
      title={t("settings.instance.title")}
      description={t("settings.instance.description")}
    >
      <Field
        id="instance-name"
        label={t("settings.instance.name")}
        value={settings.instanceName}
        onChange={(event) => update("instanceName", event.target.value)}
        errors={errors.instanceName}
      />
      <Field
        id="public-url"
        label={t("settings.instance.publicUrl")}
        type="url"
        value={settings.publicUrl}
        readOnly
        hint={t("settings.instance.publicUrlHint")}
      />
      <Field
        id="timezone"
        label={t("settings.instance.timeZone")}
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
      title={t("settings.retention.title")}
      description={t("settings.retention.description")}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <RetentionField {...props} id="backup-days" label={t("settings.retention.backups")} field="backupRetentionDays" />
        <RetentionField {...props} id="log-days" label={t("settings.retention.logs")} field="logRetentionDays" />
        <RetentionField
          {...props}
          id="orphan-days"
          label={t("settings.retention.objects")}
          field="orphanObjectRetentionDays"
        />
      </div>
      <div className="border-t">
        <SettingToggle
          id="auto-cleanup"
          title={t("settings.cleanup.title")}
          description={t("settings.cleanup.description")}
          checked={settings.automaticCleanupEnabled}
          onCheckedChange={(checked) => update("automaticCleanupEnabled", checked)}
        />
      </div>
    </Section>
  );
}

const SMTP_SECURITY: readonly { value: CockpitSmtpSecurity; labelKey: MessageKey }[] = [
  { value: "starttls", labelKey: "settings.smtp.security.starttls" },
  { value: "tls", labelKey: "settings.smtp.security.tls" },
  { value: "none", labelKey: "settings.smtp.security.none" },
];

interface MailCardProps extends CardProps {
  smtpPassword: CockpitSecret | null;
  onSecretChanged: () => void;
}

function MailCard({ settings, update, errors, smtpPassword, onSecretChanged }: MailCardProps) {
  const throughResend = settings.mailProvider === "resend";
  const securityError = errors.smtpSecurity?.[0];
  return (
    <Section title={t("settings.mail.title")} description={t("settings.mail.description")}>
      <div className="border-t">
        <SettingToggle
          id="mail-enabled"
          title={t("settings.mail.enable.title")}
          description={t("settings.mail.enable.description")}
          checked={settings.mailingEnabled}
          onCheckedChange={(checked) => update("mailingEnabled", checked)}
        />
      </div>
      <div className="flex items-start justify-between gap-4 border-t pt-5">
        <div>
          <p className="text-sm font-medium">{t("settings.mail.transport")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {throughResend ? t("settings.mail.transportResend") : t("settings.mail.transportSmtp")}
          </p>
        </div>
        <Badge variant={settings.mailReady ? "success" : "warning"}>
          {throughResend ? "Resend" : "SMTP"}
          {" · "}
          {settings.mailReady ? t("settings.mail.ready") : t("settings.mail.notReady")}
        </Badge>
      </div>
      <Field
        id="mail-from"
        label={t("settings.mail.from")}
        type="email"
        value={settings.mailFromAddress}
        onChange={(event) => update("mailFromAddress", event.target.value)}
        disabled={!settings.mailingEnabled}
        placeholder="stellarr@example.net"
        errors={errors.mailFromAddress}
      />
      <div className="grid gap-4 border-t pt-5 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Field
          id="smtp-host"
          label={t("settings.smtp.host")}
          value={settings.smtpHost}
          onChange={(event) => update("smtpHost", event.target.value)}
          placeholder="smtp.example.net"
          autoComplete="off"
          errors={errors.smtpHost}
        />
        <Field
          id="smtp-port"
          label={t("settings.smtp.port")}
          type="number"
          min={1}
          max={65535}
          value={String(settings.smtpPort)}
          onChange={(event) => update("smtpPort", Number(event.target.value))}
          errors={errors.smtpPort}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="smtp-security">{t("settings.smtp.security")}</Label>
        <Dropdown
          id="smtp-security"
          options={SMTP_SECURITY.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
          value={settings.smtpSecurity}
          onChange={(security) => update("smtpSecurity", security)}
          invalid={Boolean(securityError)}
          aria-describedby={securityError ? "smtp-security-error" : undefined}
        />
        {securityError ? (
          <p id="smtp-security-error" className="text-xs text-danger">
            {securityError}
          </p>
        ) : null}
      </div>
      <Field
        id="smtp-username"
        label={t("settings.smtp.username")}
        value={settings.smtpUsername}
        onChange={(event) => update("smtpUsername", event.target.value)}
        autoComplete="off"
        hint={t("settings.smtp.usernameHint")}
        errors={errors.smtpUsername}
      />
      <SecretField title={t("settings.smtp.password")} secret={smtpPassword} onChanged={onSecretChanged} />
    </Section>
  );
}

const MFA_REQUIREMENTS: readonly {
  value: CockpitMfaRequirement;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}[] = [
  {
    value: "optional",
    labelKey: "settings.security.requirement.optional",
    descriptionKey: "settings.security.requirement.optionalDescription",
  },
  {
    value: "admins",
    labelKey: "settings.security.requirement.admins",
    descriptionKey: "settings.security.requirement.adminsDescription",
  },
  {
    value: "everyone",
    labelKey: "settings.security.requirement.everyone",
    descriptionKey: "settings.security.requirement.everyoneDescription",
  },
  {
    value: "cockpit",
    labelKey: "settings.security.requirement.cockpit",
    descriptionKey: "settings.security.requirement.cockpitDescription",
  },
];

interface SecurityLimit {
  field: Exclude<CockpitSecurityKey, "mfaRequirement">;
  id: string;
  labelKey: MessageKey;
  min: number;
  max: number;
}

/** The ranges the server accepts (InstanceSettingsService.Validate). */
const SECURITY_LIMITS: readonly SecurityLimit[] = [
  { field: "trustedDeviceDays", id: "trusted-device-days", labelKey: "settings.security.trustedDeviceDays", min: 1, max: 365 },
  { field: "authChallengeMinutes", id: "challenge-minutes", labelKey: "settings.security.challengeMinutes", min: 1, max: 60 },
  { field: "emailCodeMinutes", id: "email-code-minutes", labelKey: "settings.security.emailCodeMinutes", min: 1, max: 60 },
  {
    field: "emailCodeCooldownSeconds",
    id: "email-cooldown-seconds",
    labelKey: "settings.security.emailCooldownSeconds",
    min: 0,
    max: 600,
  },
  { field: "emailCodeMaxAttempts", id: "email-attempts", labelKey: "settings.security.emailAttempts", min: 1, max: 10 },
  { field: "emailCodeSendsPerHour", id: "email-sends", labelKey: "settings.security.emailSendsPerHour", min: 1, max: 60 },
  { field: "cliRecoveryMinutes", id: "cli-recovery-minutes", labelKey: "settings.security.cliRecoveryMinutes", min: 1, max: 60 },
];

const withinLimit = (value: number, { min, max }: SecurityLimit) =>
  Number.isInteger(value) && value >= min && value <= max;

/** The draft's values that differ from what is stored; a value edited back to the stored one is not a change. */
function securityChanges(stored: CockpitSettings, draft: CockpitSecurityChanges): CockpitSecurityChanges {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== stored[key as CockpitSecurityKey]),
  ) as CockpitSecurityChanges;
}

interface SecurityCardProps {
  /** The stored settings with the card's unsaved changes on top. */
  settings: CockpitSettings;
  /** The requirement the server has now, before the card's changes. */
  storedRequirement: CockpitMfaRequirement;
  update: SecurityUpdate;
  errors: FieldErrors;
  canSave: boolean;
  saving: boolean;
  notice: { message: string; error: boolean } | null;
  onSave: () => void;
}

/**
 * The account security settings, saved by the card's own button. The card is
 * not a form of its own, so it can sit inside the page's: Enter in one of its
 * fields saves the card instead of submitting the page around it.
 */
function SecurityCard({ settings, storedRequirement, update, errors, canSave, saving, notice, onSave }: SecurityCardProps) {
  const requirementError = errors.mfaRequirement?.[0];
  function saveOnEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (canSave) onSave();
  }
  // Anything but optional makes Cockpit ask for a second factor. A stored
  // requirement left as it is changes nothing, so it does not warn.
  const locksCockpit = settings.mfaRequirement !== "optional" && settings.mfaRequirement !== storedRequirement;
  return (
    <Section title={t("settings.security.title")} description={t("settings.security.description")}>
      {/* The segments take the arrows and leave Enter alone, so it bubbles up to this handler. */}
      <div className="space-y-3" onKeyDown={saveOnEnter}>
        <p className="text-sm font-medium">{t("settings.security.requirement")}</p>
        <Segmented
          options={MFA_REQUIREMENTS.map(({ value, labelKey, descriptionKey }) => ({
            value,
            label: t(labelKey),
            detail: t(descriptionKey),
          }))}
          value={settings.mfaRequirement}
          onChange={(requirement) => update("mfaRequirement", requirement)}
          label={t("settings.security.requirement")}
          className="requirement-cards"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.security.cockpitNote")} {t("settings.security.sessionsNote")}
        </p>
        {requirementError ? <p className="text-xs text-danger">{requirementError}</p> : null}
      </div>
      {locksCockpit ? (
        <Alert>
          <AlertTitle>{t("settings.security.warning.title")}</AlertTitle>
          <AlertDescription>{t("settings.security.warning.description")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        {SECURITY_LIMITS.map((limit) => {
          const value = settings[limit.field];
          const outside = !withinLimit(value, limit);
          return (
            <Field
              key={limit.field}
              id={limit.id}
              label={t(limit.labelKey)}
              type="number"
              min={limit.min}
              max={limit.max}
              step={1}
              value={String(value)}
              onChange={(event) => update(limit.field, Number(event.target.value))}
              onKeyDown={saveOnEnter}
              hint={outside ? undefined : t("settings.security.range", { min: limit.min, max: limit.max })}
              errors={
                outside
                  ? [t("settings.security.outOfRange", { min: limit.min, max: limit.max })]
                  : errors[limit.field]
              }
            />
          );
        })}
      </div>
      <div className="flex flex-col items-end gap-2 border-t pt-5">
        <Button type="button" disabled={!canSave} onClick={onSave}>
          {saving ? <Spinner /> : null}
          {saving ? t("common.saving") : t("settings.security.save")}
        </Button>
        {notice ? (
          <p className={notice.error ? "text-xs text-danger" : "text-xs text-success"} role={notice.error ? "alert" : "status"}>
            {notice.message}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function TestMail({ settings }: { settings: CockpitSettings }) {
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setResult(null);
    setFailure(null);
    try {
      const { id, provider } = await cockpitApi.sendTestMail(recipient.trim());
      setResult(t("settings.test.accepted", { id, provider: provider === "resend" ? "Resend" : "SMTP" }));
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : t("settings.test.failed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-5">
      <div>
        <Label htmlFor="test-recipient">{t("settings.test.recipient")}</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.test.hint", { provider: settings.mailProvider === "resend" ? "Resend" : "SMTP" })}
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
          variant="secondary"
          onClick={() => void send()}
          disabled={
            sending || !settings.mailingEnabled || !settings.mailReady || !recipient.trim()
          }
        >
          {sending ? <Spinner /> : null}
          {sending ? t("settings.test.sending") : t("settings.test.send")}
        </Button>
      </div>
      {result ? (
        <p className="text-xs text-success" role="status">
          {result}
        </p>
      ) : null}
      {failure ? (
        <p className="text-xs text-danger" role="alert">
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
      title={t("settings.delivery.title")}
      description={t("settings.delivery.description")}
    >
      <TestMail settings={settings} />
      <div className="border-t">
        <SettingToggle
          id="invite-mail"
          title={t("settings.delivery.invite.title")}
          description={t("settings.delivery.invite.description")}
          checked={settings.inviteMailEnabled}
          onCheckedChange={(checked) => update("inviteMailEnabled", checked)}
          disabled={mailOff}
        />
        <SettingToggle
          id="recovery-mail"
          title={t("settings.delivery.recovery.title")}
          description={t("settings.delivery.recovery.description")}
          checked={settings.recoveryMailEnabled}
          onCheckedChange={(checked) => update("recoveryMailEnabled", checked)}
          disabled={mailOff}
        />
        <SettingToggle
          id="alert-mail"
          title={t("settings.delivery.alert.title")}
          description={t("settings.delivery.alert.description")}
          checked={settings.alertMailEnabled}
          onCheckedChange={(checked) => update("alertMailEnabled", checked)}
          disabled={mailOff}
        />
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const { reload } = useCockpit();
  const { data, error: loadError } = useCockpitResource(cockpitApi.settings, t("settings.loadFailed"));
  const secrets = useCockpitResource(cockpitApi.secrets, t("secret.loadFailed"));
  const { refresh: refreshSecrets } = secrets;
  // What the server last stored, once a save has returned it, and the edits made since.
  const [stored, setStored] = useState<CockpitSettings | null>(null);
  const [edits, setEdits] = useState<Partial<CockpitSettings>>({});
  // The security card's edits, kept apart: each save sends and clears only its own.
  const [securityEdits, setSecurityEdits] = useState<CockpitSecurityChanges>({});
  // One save at a time: each sends the stored values of what it does not own.
  const [saving, setSaving] = useState<"settings" | "security" | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [securityNotice, setSecurityNotice] = useState<SecurityCardProps["notice"]>(null);
  const [securityErrors, setSecurityErrors] = useState<FieldErrors>({});

  const base = stored ?? data;
  const settings = base ? { ...base, ...edits } : null;
  const security = base ? { ...base, ...securityEdits } : null;
  const securityChanged = base ? Object.keys(securityChanges(base, securityEdits)).length > 0 : false;
  const securityValid = security
    ? SECURITY_LIMITS.every((limit) => withinLimit(security[limit.field], limit))
    : false;
  const canSaveSecurity = saving === null && securityChanged && securityValid;

  const update: Update = (key, value) => {
    setEdits((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setSaveError(null);
    setFieldErrors({});
  };

  const updateSecurity: SecurityUpdate = (key, value) => {
    setSecurityEdits((current) => ({ ...current, [key]: value }));
    setSecurityNotice(null);
    setSecurityErrors({});
  };

  // A secret changes whether mail is ready, so the settings are read again with it.
  async function secretChanged() {
    const [fresh] = await Promise.all([cockpitApi.settings(), refreshSecrets()]);
    setStored(fresh);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving("settings");
    setSaved(false);
    setSaveError(null);
    setFieldErrors({});
    try {
      setStored(await cockpitApi.updateSettings(settings));
      setEdits({});
      setSaved(true);
      await reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t("settings.saveFailed"));
      if (cause instanceof CockpitApiError) setFieldErrors(cause.errors);
    } finally {
      setSaving(null);
    }
  }

  // Sends the stored values of the other cards, so their unsaved edits stay
  // edits, and of the security settings only those that changed. Nothing in
  // the shell shows these settings, so the panel is not reloaded.
  async function saveSecurity() {
    if (!base || !canSaveSecurity) return;
    setSaving("security");
    setSecurityNotice(null);
    setSecurityErrors({});
    try {
      setStored(await cockpitApi.updateSettings(base, securityChanges(base, securityEdits)));
      setSecurityEdits({});
      setSecurityNotice({ message: t("settings.security.saved"), error: false });
    } catch (cause) {
      setSecurityNotice({ message: cause instanceof Error ? cause.message : t("settings.saveFailed"), error: true });
      if (cause instanceof CockpitApiError) setSecurityErrors(cause.errors);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
        actions={
          <Button type="submit" form="cockpit-settings-form" disabled={!settings || saving !== null}>
            {saving === "settings" ? <Spinner /> : null}
            {saving === "settings" ? t("common.saving") : t("settings.save")}
          </Button>
        }
      />

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("settings.loadError")}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("settings.saveError")}</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <AlertTitle>{t("settings.saved.title")}</AlertTitle>
          <AlertDescription>{t("settings.saved.description")}</AlertDescription>
        </Alert>
      ) : null}

      {!settings && !loadError ? (
        <div
          role="status"
          className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          {t("settings.loading")}
        </div>
      ) : null}

      {base && settings && security ? (
        <form
          id="cockpit-settings-form"
          onSubmit={(event) => void save(event)}
          className="relative grid min-h-0 flex-1 items-start gap-6 overflow-y-auto lg:grid-cols-2"
        >
          <div className="space-y-6">
            <InstanceCard settings={settings} update={update} errors={fieldErrors} />
            <RetentionCard settings={settings} update={update} errors={fieldErrors} />
            <SecurityCard
              settings={security}
              storedRequirement={base.mfaRequirement}
              update={updateSecurity}
              errors={securityErrors}
              canSave={canSaveSecurity}
              saving={saving === "security"}
              notice={securityNotice}
              onSave={() => void saveSecurity()}
            />
            <LanguageCard />
          </div>
          <div className="space-y-6">
            <MailCard
              settings={settings}
              update={update}
              errors={fieldErrors}
              smtpPassword={secrets.data?.find((secret) => secret.name === "mail.smtp-password") ?? null}
              onSecretChanged={() => void secretChanged()}
            />
            <DeliveryCard settings={settings} update={update} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
