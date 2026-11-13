"use client";

import { useId, useState, type ChangeEvent } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import type { Translator } from "@/i18n";
import type { Account, EmailChangeResult, PasswordChangeResult } from "@/ports";
import { useLanguage } from "@/state/hooks";

import {
  AccountSecuritySections,
  type AccountSecuritySectionsProps,
} from "./AccountSecuritySections";

/** The server rejects shorter passwords too; checking here saves a round trip. */
const MIN_PASSWORD_LENGTH = 8;
const MAX_EMAIL_LENGTH = 320;

export interface SecurityPaneProps {
  account: Account;
  emailSupported: boolean;
  /** The second factor, trusted devices and history, when the container wires them. */
  twoStep?: AccountSecuritySectionsProps;
  /** Mails a link to the new address; the address changes when it is opened. */
  onChangeEmail(email: string, password: string): Promise<EmailChangeResult>;
  onChangePassword(current: string, next: string): Promise<PasswordChangeResult>;
  /**
   * Asks for a fresh second step; true once it is passed, false when the
   * person closes it. The password change is then tried again.
   */
  onConfirmSecondStep?(): Promise<boolean>;
}

type EmailAnswer = EmailChangeResult | "failed";
type PasswordAnswer = PasswordChangeResult | "failed";

function emailAnswerText(t: Translator, answer: Exclude<EmailAnswer, "sent">): string {
  switch (answer) {
    case "wrong-password":
      return t("account.passwordWrongCurrent");
    case "second-step-required":
      return t("account.emailSecondStep");
    case "same":
      return t("account.emailSame");
    case "taken":
      return t("account.emailTaken");
    case "mail-unavailable":
      return t("account.emailMailUnavailable");
    case "failed":
      return t("account.emailSaveFailed");
  }
}

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
    case "second-step-required":
      return t("account.passwordSecondStep");
    case "failed":
      return t("account.passwordChangeFailed");
  }
}

function EmailSection({
  savedEmail,
  supported,
  onChangeEmail,
  onConfirmSecondStep,
}: {
  savedEmail: string;
  supported: boolean;
  onChangeEmail: SecurityPaneProps["onChangeEmail"];
  onConfirmSecondStep: SecurityPaneProps["onConfirmSecondStep"];
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(savedEmail);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<EmailAnswer | null>(null);
  const [sentTo, setSentTo] = useState("");

  // The account store publishes an accepted address. Adopt it at once and
  // close the editor, so no stale draft outlives the value it was based on.
  const [seenEmail, setSeenEmail] = useState(savedEmail);
  if (seenEmail !== savedEmail) {
    setSeenEmail(savedEmail);
    setDraft(savedEmail);
    setPassword("");
    setOpen(false);
  }

  const value = draft.trim();
  const canSave = !saving && value.length > 0 && value !== savedEmail && password.length > 0;

  const toggle = () => {
    setOpen((wasOpen) => !wasOpen);
    setAnswer(null);
  };

  const cancel = () => {
    setDraft(savedEmail);
    setPassword("");
    setOpen(false);
    setAnswer(null);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setAnswer(null);
    try {
      let result = await onChangeEmail(value, password);
      // The server wants a recent second step first: ask for it, then try again once.
      if (result === "second-step-required" && onConfirmSecondStep !== undefined && (await onConfirmSecondStep())) {
        result = await onChangeEmail(value, password);
      }
      setAnswer(result);
      if (result === "sent") {
        setSentTo(value);
        setPassword("");
        setOpen(false);
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
          <b id={titleId}>{t("account.recoveryEmail")}</b>
          <span className={savedEmail.length === 0 ? "empty" : undefined}>
            {savedEmail || t("account.emailNotSet")}
          </span>
          <small>{t("account.recoveryEmailDetail")}</small>
        </span>
        {supported ? (
          <Button type="button" variant="secondary" size="sm" aria-expanded={open} onClick={toggle}>
            {savedEmail.length === 0 ? t("account.addEmail") : t("account.changeEmail")}
          </Button>
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
              setAnswer(null);
            }}
          />
          <PasswordField
            label={t("account.currentPassword")}
            autoComplete="current-password"
            value={password}
            invalid={answer === "wrong-password"}
            onChange={(event) => {
              setPassword(event.target.value);
              setAnswer(null);
            }}
          />
          <p className="set-note">{t("account.emailLinkNote")}</p>
          <div className="acc-credential-actions">
            <Button type="button" variant="secondary" onClick={cancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!canSave}>
              {saving ? t("common.saving") : t("account.sendEmailLink")}
            </Button>
          </div>
        </form>
      ) : null}

      {answer === "sent" ? (
        <p className="acc-answer ok" role="status">{t("account.emailLinkSent", { email: sentTo })}</p>
      ) : answer !== null ? (
        <p className="acc-answer bad" role="alert">{emailAnswerText(t, answer)}</p>
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
  onChangePassword,
  onConfirmSecondStep,
}: {
  onChangePassword: SecurityPaneProps["onChangePassword"];
  onConfirmSecondStep: SecurityPaneProps["onConfirmSecondStep"];
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(NO_PASSWORDS);
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<PasswordAnswer | null>(null);

  const mismatch = fields.confirm.length > 0 && fields.next !== fields.confirm;
  const canChange =
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
      let result = await onChangePassword(fields.current, fields.next);
      // The server wants a recent second step first: ask for it, then try again once.
      if (result === "second-step-required" && onConfirmSecondStep !== undefined && (await onConfirmSecondStep())) {
        result = await onChangePassword(fields.current, fields.next);
      }
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? t("account.cancelPasswordChange") : t("account.changePassword")}
        </Button>
      </div>

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
            <Button type="button" variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!canChange}>
              {saving ? t("common.saving") : t("account.changePassword")}
            </Button>
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
  twoStep,
  onChangeEmail,
  onChangePassword,
  onConfirmSecondStep,
}: SecurityPaneProps) {
  const { t } = useLanguage();
  return (
    <>
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
            onConfirmSecondStep={onConfirmSecondStep}
          />
          <PasswordSection onChangePassword={onChangePassword} onConfirmSecondStep={onConfirmSecondStep} />
        </div>
      </section>
      {twoStep ? <AccountSecuritySections {...twoStep} /> : null}
    </>
  );
}
