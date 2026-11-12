"use client";

import { useId, useState, type ChangeEvent } from "react";

import { Icon } from "@stellarr/ui/icons";
import type { Translator } from "@/i18n";
import type { Account, PasswordChangeResult } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** The server rejects shorter passwords too; checking here saves a round trip. */
const MIN_PASSWORD_LENGTH = 8;
const MAX_EMAIL_LENGTH = 320;

export interface SecurityPaneProps {
  account: Account;
  emailSupported: boolean;
  passwordSupported: boolean;
  onChangeEmail(email: string): Promise<void> | void;
  onChangePassword(current: string, next: string): Promise<PasswordChangeResult>;
}

/** What the last finished save said; a save in flight is tracked apart from it. */
type EmailOutcome = "none" | "saved" | "failed";
type PasswordAnswer = PasswordChangeResult | "failed";

function passwordAnswerText(t: Translator, answer: PasswordAnswer): string {
  switch (answer) {
    case "changed":
      return t("account.passwordChanged");
    case "wrong-current":
      return t("account.passwordWrongCurrent");
    case "too-short":
      return t("account.passwordTooShort");
    case "same-as-current":
      return t("account.passwordSame");
    case "failed":
      return t("account.passwordChangeFailed");
  }
}

function EmailSection({
  savedEmail,
  supported,
  onChangeEmail,
}: {
  savedEmail: string;
  supported: boolean;
  onChangeEmail: SecurityPaneProps["onChangeEmail"];
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(savedEmail);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<EmailOutcome>("none");

  // The account store publishes an accepted address. Adopt it at once and
  // close the editor, so no stale draft outlives the value it was based on.
  const [seenEmail, setSeenEmail] = useState(savedEmail);
  if (seenEmail !== savedEmail) {
    setSeenEmail(savedEmail);
    setDraft(savedEmail);
    setOpen(false);
  }

  const value = draft.trim();
  const canSave = !saving && value.length > 0 && value !== savedEmail;

  const toggle = () => {
    setOpen((wasOpen) => !wasOpen);
    setOutcome("none");
  };

  const cancel = () => {
    setDraft(savedEmail);
    setOpen(false);
    setOutcome("none");
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setOutcome("none");
    try {
      await onChangeEmail(value);
      setOutcome("saved");
      setOpen(false);
    } catch {
      setOutcome("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="acc-security-item" aria-labelledby={titleId}>
      <div className="acc-security-summary">
        <span className="acc-security-copy">
          <b id={titleId}>{t("account.recoveryEmail")}</b>
          <span className={savedEmail.length === 0 ? "empty" : undefined}>
            {savedEmail || t("account.emailNotSet")}
          </span>
          <small>{t("account.recoveryEmailDetail")}</small>
        </span>
        {supported ? (
          <button type="button" className="btn-ghost sm" aria-expanded={open} onClick={toggle}>
            {savedEmail.length === 0 ? t("account.addEmail") : t("account.changeEmail")}
          </button>
        ) : null}
      </div>

      {supported ? null : <p className="set-note">{t("account.emailChangeUnavailable")}</p>}

      {open ? (
        <form
          className="acc-credential-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="frm-lab" htmlFor={fieldId}>
            {t("account.newEmail")}
          </label>
          <input
            id={fieldId}
            className="set-input"
            type="email"
            autoComplete="email"
            value={draft}
            maxLength={MAX_EMAIL_LENGTH}
            required
            onChange={(event) => {
              setDraft(event.target.value);
              setOutcome("none");
            }}
          />
          <div className="acc-credential-actions">
            <button type="button" className="btn-ghost" onClick={cancel}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={!canSave}>
              {saving ? t("common.saving") : t("account.saveEmail")}
            </button>
          </div>
        </form>
      ) : null}

      {outcome === "saved" ? (
        <p className="acc-answer ok" role="status">{t("account.emailSaved")}</p>
      ) : null}
      {outcome === "failed" ? (
        <p className="acc-answer bad" role="alert">{t("account.emailSaveFailed")}</p>
      ) : null}
    </section>
  );
}

interface PasswordFieldProps {
  label: string;
  hint?: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  invalid?: boolean;
  /** Shown under the field, for a problem the field itself can name. */
  problem?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function PasswordField({
  label,
  hint,
  autoComplete,
  value,
  invalid,
  problem,
  onChange,
}: PasswordFieldProps) {
  const id = useId();
  return (
    <div className="frm-row">
      <label className="frm-lab" htmlFor={id}>
        {label}
        {hint === undefined ? null : <span>{hint}</span>}
      </label>
      <div className="frm-ctl">
        <input
          id={id}
          className="set-input"
          type="password"
          autoComplete={autoComplete}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={onChange}
        />
        {problem === undefined ? null : (
          <p className="acc-answer bad" role="alert">{problem}</p>
        )}
      </div>
    </div>
  );
}

const NO_PASSWORDS = { current: "", next: "", confirm: "" };

function PasswordSection({
  supported,
  onChangePassword,
}: {
  supported: boolean;
  onChangePassword: SecurityPaneProps["onChangePassword"];
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(NO_PASSWORDS);
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<PasswordAnswer | null>(null);

  const mismatch = fields.confirm.length > 0 && fields.next !== fields.confirm;
  const canChange =
    supported &&
    !saving &&
    fields.current.length > 0 &&
    fields.next.length >= MIN_PASSWORD_LENGTH &&
    fields.next === fields.confirm;

  const edit = (field: keyof typeof NO_PASSWORDS) => (event: ChangeEvent<HTMLInputElement>) => {
    setFields((previous) => ({ ...previous, [field]: event.target.value }));
    setAnswer(null);
  };

  const close = () => {
    setOpen(false);
    setFields(NO_PASSWORDS);
    setAnswer(null);
  };

  const toggle = () => {
    if (open) close();
    else {
      setOpen(true);
      setAnswer(null);
    }
  };

  const submit = async () => {
    setSaving(true);
    setAnswer(null);
    try {
      const result = await onChangePassword(fields.current, fields.next);
      setAnswer(result);
      if (result === "changed") {
        setOpen(false);
        setFields(NO_PASSWORDS);
      }
    } catch {
      setAnswer("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="acc-security-item" aria-labelledby={titleId}>
      <div className="acc-security-summary">
        <span className="acc-security-copy">
          <b id={titleId}>{t("account.password")}</b>
          <span>{t("account.passwordHidden")}</span>
          <small>{t("account.passwordDetail")}</small>
        </span>
        <button
          type="button"
          className="btn-ghost sm"
          aria-expanded={open}
          disabled={!supported}
          onClick={toggle}
        >
          {open ? t("account.cancelPasswordChange") : t("account.changePassword")}
        </button>
      </div>

      {supported ? null : <p className="set-note">{t("account.passwordUnsupported")}</p>}

      {open ? (
        <form
          className="frm acc-password-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canChange) void submit();
          }}
        >
          <PasswordField
            label={t("account.currentPassword")}
            autoComplete="current-password"
            value={fields.current}
            onChange={edit("current")}
          />
          <PasswordField
            label={t("account.newPassword")}
            hint={t("account.passwordMinLength")}
            autoComplete="new-password"
            value={fields.next}
            onChange={edit("next")}
          />
          <PasswordField
            label={t("account.repeatNewPassword")}
            autoComplete="new-password"
            value={fields.confirm}
            invalid={mismatch}
            problem={mismatch ? t("account.passwordMismatch") : undefined}
            onChange={edit("confirm")}
          />
          <div className="acc-credential-actions">
            <button type="button" className="btn-ghost" onClick={close}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={!canChange}>
              {saving ? t("common.saving") : t("account.changePassword")}
            </button>
          </div>
        </form>
      ) : null}

      {answer === null ? null : (
        <p
          className={answer === "changed" ? "acc-answer ok" : "acc-answer bad"}
          role={answer === "changed" ? "status" : "alert"}
        >
          {passwordAnswerText(t, answer)}
        </p>
      )}
    </section>
  );
}

/** Login details stay apart from the public profile and are saved on their own. */
export function SecurityPane({
  account,
  emailSupported,
  passwordSupported,
  onChangeEmail,
  onChangePassword,
}: SecurityPaneProps) {
  const { t } = useLanguage();
  return (
    <section className="sc acc-security">
      <header className="sc-h">
        <span className="sc-ico" aria-hidden="true">
          <Icon name="lock" size={17} />
        </span>
        {t("account.loginSecurity")}
      </header>
      <div className="sc-b acc-security-list">
        <EmailSection
          savedEmail={account.email ?? ""}
          supported={emailSupported}
          onChangeEmail={onChangeEmail}
        />
        <PasswordSection supported={passwordSupported} onChangePassword={onChangePassword} />
      </div>
    </section>
  );
}
