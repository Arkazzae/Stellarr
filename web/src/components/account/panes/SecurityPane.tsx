"use client";

import { useId, useState, type ChangeEvent } from "react";

import { Button } from "@stellarr/ui";
import type { Translator } from "@/i18n";
import type { Account, EmailChangeResult, PasswordChangeResult } from "@/ports";
import { useLanguage } from "@/state/hooks";

import {
  IdentitiesSection,
  TwoStepSection,
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
   * person closes it. The change is then tried again.
   */
  onConfirmSecondStep?(): Promise<boolean>;
}

type EmailAnswer = EmailChangeResult | "failed";
type PasswordAnswer = PasswordChangeResult | "failed";
/** The one credential being edited; opening the other closes it. */
type Editor = "password" | "email" | null;

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

interface FieldProps {
  label: string;
  type: "email" | "password";
  autoComplete: "email" | "current-password" | "new-password";
  value: string;
  /** Spans both columns of the form. */
  full?: boolean;
  hint?: string;
  invalid?: boolean;
  /** Shown under the field, for a problem the field itself can name. */
  problem?: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** A label above its field, so a long label never squeezes the field beside it. */
function Field({ label, type, autoComplete, value, full, hint, invalid, problem, maxLength, onChange }: FieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={full ? "sec-field full" : "sec-field"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="set-input"
        type={type}
        autoComplete={autoComplete}
        value={value}
        maxLength={maxLength}
        required={type === "email" || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={onChange}
      />
      {hint === undefined ? null : <small id={hintId}>{hint}</small>}
      {problem === undefined ? null : (
        <small data-tone="bad" role="alert">{problem}</small>
      )}
    </div>
  );
}

interface EditorProps {
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onConfirmSecondStep: SecurityPaneProps["onConfirmSecondStep"];
}

function EmailItem({
  savedEmail,
  supported,
  onChangeEmail,
  onConfirmSecondStep,
  open,
  onOpen,
  onClose,
}: EditorProps & {
  savedEmail: string;
  supported: boolean;
  onChangeEmail: SecurityPaneProps["onChangeEmail"];
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const [draft, setDraft] = useState(savedEmail);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<EmailAnswer | null>(null);
  const [sentTo, setSentTo] = useState("");

  // The account store publishes an accepted address. Adopt it at once; the
  // pane closes the editor, so no stale draft outlives the value it was based on.
  const [seenEmail, setSeenEmail] = useState(savedEmail);
  if (seenEmail !== savedEmail) {
    setSeenEmail(savedEmail);
    setDraft(savedEmail);
    setPassword("");
  }

  // Closed by the other editor or by cancelling, the draft goes with it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setDraft(savedEmail);
      setPassword("");
    }
    if (open) setAnswer(null);
  }

  const value = draft.trim();
  const canSave = !saving && value.length > 0 && value !== savedEmail && password.length > 0;
  const empty = savedEmail.length === 0;

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
        onClose();
      }
    } catch {
      setAnswer("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sec-item" aria-labelledby={titleId}>
      <div className="sec-row">
        <span className="sec-copy">
          <b id={titleId}>{t("account.email")}</b>
          <span className={empty ? "sec-value empty" : "sec-value"}>
            {savedEmail || t("account.emailNotSet")}
          </span>
          {supported ? (
            <small data-tone={empty ? "warn" : undefined}>
              {t(empty ? "account.emailMissingDetail" : "account.recoveryEmailDetail")}
            </small>
          ) : (
            <small>{t("account.emailChangeUnavailable")}</small>
          )}
        </span>
        {supported && !open ? (
          <Button type="button" variant="secondary" size="sm" onClick={onOpen}>
            {empty ? t("account.addEmail") : t("account.changeEmail")}
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          className="sec-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field
            full
            label={t("account.newEmail")}
            type="email"
            autoComplete="email"
            value={draft}
            maxLength={MAX_EMAIL_LENGTH}
            onChange={(event) => {
              setDraft(event.target.value);
              setAnswer(null);
            }}
          />
          <Field
            full
            label={t("account.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={password}
            invalid={answer === "wrong-password"}
            onChange={(event) => {
              setPassword(event.target.value);
              setAnswer(null);
            }}
          />
          <p className="sec-note">{t("account.emailLinkNote")}</p>
          <div className="sec-form-actions">
            <Button type="button" variant="quiet" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!canSave}>
              {saving ? t("common.saving") : t("account.sendEmailLink")}
            </Button>
          </div>
        </form>
      ) : null}

      {answer === "sent" ? (
        <p className="sec-answer" data-tone="ok" role="status">
          {t("account.emailLinkSent", { email: sentTo })}
        </p>
      ) : answer !== null ? (
        <p className="sec-answer" data-tone="bad" role="alert">{emailAnswerText(t, answer)}</p>
      ) : null}
    </section>
  );
}

const NO_PASSWORDS = { current: "", next: "", confirm: "" };

function PasswordItem({
  onChangePassword,
  onConfirmSecondStep,
  open,
  onOpen,
  onClose,
}: EditorProps & { onChangePassword: SecurityPaneProps["onChangePassword"] }) {
  const { t } = useLanguage();
  const titleId = useId();
  const [fields, setFields] = useState(NO_PASSWORDS);
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<PasswordAnswer | null>(null);

  // Closed by the other editor or by cancelling, nothing typed is kept.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setFields(NO_PASSWORDS);
    if (open) setAnswer(null);
  }

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
      if (result === "changed") onClose();
    } catch {
      setAnswer("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sec-item" aria-labelledby={titleId}>
      <div className="sec-row">
        <span className="sec-copy">
          <b id={titleId}>{t("account.password")}</b>
          <small>{t("account.passwordDetail")}</small>
        </span>
        {open ? null : (
          <Button type="button" variant="secondary" size="sm" onClick={onOpen}>
            {t("account.changePassword")}
          </Button>
        )}
      </div>

      {open ? (
        <form
          className="sec-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canChange) void submit();
          }}
        >
          <Field
            full
            label={t("account.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={fields.current}
            invalid={answer === "wrong-current"}
            onChange={edit("current")}
          />
          <Field
            label={t("account.newPassword")}
            type="password"
            autoComplete="new-password"
            hint={t("account.passwordMinLength")}
            value={fields.next}
            onChange={edit("next")}
          />
          <Field
            label={t("account.repeatNewPassword")}
            type="password"
            autoComplete="new-password"
            value={fields.confirm}
            invalid={mismatch}
            problem={mismatch ? t("account.passwordMismatch") : undefined}
            onChange={edit("confirm")}
          />
          <div className="sec-form-actions">
            <Button type="button" variant="quiet" onClick={onClose}>
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
          className="sec-answer"
          data-tone={answer === "changed" ? "ok" : "bad"}
          role={answer === "changed" ? "status" : "alert"}
        >
          {passwordAnswerText(t, answer)}
        </p>
      )}
    </section>
  );
}

/**
 * How the account is signed in to, apart from the public profile.
 *
 * The second step leads, because it is the one choice here that decides what
 * a stolen password is worth. The password and the address follow as two
 * rows of one group, each editing in place and one at a time, so the pane
 * never holds two half-filled forms. The providers come last, on an instance
 * that has them.
 */
export function SecurityPane({
  account,
  emailSupported,
  twoStep,
  onChangeEmail,
  onChangePassword,
  onConfirmSecondStep,
}: SecurityPaneProps) {
  const { t } = useLanguage();
  const [editor, setEditor] = useState<Editor>(null);
  const email = account.email ?? "";

  // An answer that arrives after the other editor was opened leaves it alone.
  const close = (which: Exclude<Editor, null>) =>
    setEditor((current) => (current === which ? null : current));

  // An address replaced from elsewhere (the link opened on another device)
  // closes its editor: the draft was based on the address that is gone.
  const [seenEmail, setSeenEmail] = useState(email);
  if (seenEmail !== email) {
    setSeenEmail(email);
    if (editor === "email") setEditor(null);
  }

  return (
    <>
      {twoStep ? <TwoStepSection {...twoStep} email={email} /> : null}

      <section className="sc">
        <header className="sc-h">{t("account.passwordAndEmail")}</header>
        <div className="sc-b sec-list">
          <PasswordItem
            open={editor === "password"}
            onOpen={() => setEditor("password")}
            onClose={() => close("password")}
            onChangePassword={onChangePassword}
            onConfirmSecondStep={onConfirmSecondStep}
          />
          <EmailItem
            open={editor === "email"}
            onOpen={() => setEditor("email")}
            onClose={() => close("email")}
            savedEmail={email}
            supported={emailSupported}
            onChangeEmail={onChangeEmail}
            onConfirmSecondStep={onConfirmSecondStep}
          />
        </div>
      </section>

      {twoStep ? <IdentitiesSection {...twoStep} /> : null}
    </>
  );
}
