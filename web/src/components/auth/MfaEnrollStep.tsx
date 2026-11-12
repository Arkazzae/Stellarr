"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { AuthFrame, authStyles as styles } from "@/components/auth/AuthFrame";
import type { Translator } from "@/i18n";
import type { MfaChallenge, MfaEnrollment } from "@/ports";

import steps from "./SignInSteps.module.css";

export type EnrollMode = "totp" | "email";

export interface MfaEnrollStepProps {
  challenge: MfaChallenge;
  t: Translator;
  mode: EnrollMode;
  /** The authenticator key being set up; null until the server has made one. */
  enrollment: MfaEnrollment | null;
  /** Seconds to wait before another email code, once the first one went out. */
  emailRetryAfter: number | null;
  pending: boolean;
  error: string | null;
  /** The QR image of `otpAuthUri`, drawn on this device. */
  qr?: ReactNode;
  onModeChange(mode: EnrollMode): void;
  onSendEmailCode(): void;
  onConfirm(input: { code: string; rememberDevice: boolean }): void;
  onCancel(): void;
}

/** "ABCD EFGH IJKL", which is easier to copy by eye than one long run. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * Sets up the first method when a sign-in requires one, or a replacement after
 * an operator's recovery. The key is shown once and never kept by the client.
 */
export function MfaEnrollStep({
  challenge,
  t,
  mode,
  enrollment,
  emailRetryAfter,
  pending,
  error,
  qr,
  onModeChange,
  onSendEmailCode,
  onConfirm,
  onCancel,
}: MfaEnrollStepProps) {
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const message = localError ?? error;
  const recovery = challenge.purpose === "recovery";
  const secret = enrollment?.type === "totp" ? enrollment.secret : undefined;

  useEffect(() => {
    if (error) codeRef.current?.focus();
  }, [error]);

  const copy = async () => {
    if (secret === undefined) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // The key is selectable on screen, so a refused clipboard costs nothing.
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const typed = code.replace(/\s+/g, "");
    if (!typed) {
      setLocalError(t("auth.mfa.codeMissing"));
      codeRef.current?.focus();
      return;
    }
    setLocalError(null);
    onConfirm({ code: typed, rememberDevice: remember });
  };

  const switchTo = (next: EnrollMode) => {
    setCode("");
    setLocalError(null);
    setCopied(false);
    onModeChange(next);
  };

  const fieldState = { invalid: Boolean(message), errorId: message ? errorId : undefined };
  const ready = mode === "email" ? emailRetryAfter !== null : secret !== undefined;

  return (
    <AuthFrame
      title={recovery ? t("auth.enroll.recoveryTitle") : t("auth.enroll.title")}
      description={recovery ? t("auth.enroll.recoveryDescription") : t("auth.enroll.description")}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {mode === "totp" ? (
          secret === undefined ? (
            <p className={styles.checking} aria-busy="true">
              {t("auth.enroll.preparing")}
            </p>
          ) : (
            <>
              <p className={steps.note}>{t("auth.enroll.scan")}</p>
              {qr}
              <div className={steps.key}>
                <span className={steps.keyLabel} id={`${errorId}-key`}>
                  {t("auth.enroll.key")}
                </span>
                <div className={steps.keyRow}>
                  <code className={steps.keyValue} aria-labelledby={`${errorId}-key`}>
                    {grouped(secret)}
                  </code>
                  <button type="button" className={steps.copy} onClick={() => void copy()}>
                    {copied ? t("auth.enroll.copied") : t("auth.enroll.copy")}
                  </button>
                </div>
              </div>
            </>
          )
        ) : (
          <>
            <p className={steps.note}>{t("auth.enroll.emailDescription")}</p>
            <button
              type="button"
              className={styles.externalLogin}
              onClick={onSendEmailCode}
              disabled={pending || (emailRetryAfter !== null && emailRetryAfter > 0)}
            >
              {emailRetryAfter === null
                ? t("auth.mfa.sendEmail")
                : emailRetryAfter > 0
                  ? t("auth.mfa.resendIn", { seconds: emailRetryAfter })
                  : t("auth.mfa.resendEmail")}
            </button>
          </>
        )}

        {ready ? (
          <>
            <AuthField
              ref={codeRef}
              label={t("auth.mfa.code")}
              hint={mode === "totp" ? t("auth.enroll.codeHint") : t("auth.mfa.emailSent")}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={pending}
              {...fieldState}
            />

            <label className={steps.check}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={pending}
              />
              <span>{t("auth.mfa.remember", { days: challenge.trustedDeviceDays })}</span>
            </label>
          </>
        ) : null}

        {message ? (
          <p className={styles.error} id={errorId} role="alert">
            {message}
          </p>
        ) : null}

        {ready ? (
          <button type="submit" className={styles.submit} disabled={pending}>
            {pending ? t("auth.mfa.pending") : t("auth.enroll.confirm")}
          </button>
        ) : null}
      </form>

      <nav className={styles.links} aria-label={t("auth.mfa.otherWays")}>
        {mode === "totp" ? (
          <button type="button" className={styles.textLink} onClick={() => switchTo("email")}>
            {t("auth.enroll.useEmail")}
          </button>
        ) : (
          <button type="button" className={styles.textLink} onClick={() => switchTo("totp")}>
            {t("auth.enroll.useTotp")}
          </button>
        )}
        <button type="button" className={styles.textLink} onClick={onCancel}>
          {t("auth.mfa.cancel")}
        </button>
      </nav>
    </AuthFrame>
  );
}
