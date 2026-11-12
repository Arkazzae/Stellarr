"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { AuthFrame, authStyles as styles } from "@/components/auth/AuthFrame";
import type { Translator } from "@/i18n";
import type { MfaChallenge, MfaMethod } from "@/ports";

import steps from "./SignInSteps.module.css";

type Mode = "totp" | "email" | "recovery";

export interface MfaChallengeStepProps {
  challenge: MfaChallenge;
  t: Translator;
  pending: boolean;
  error: string | null;
  onVerify(input: { methodId?: string; code: string; rememberDevice: boolean }): void;
  onUseTrustedDevice(): void;
  /** Resolves with the seconds until another code may be sent, or null when sending failed. */
  onSendEmailCode(methodId: string): Promise<number | null>;
  onCancel(): void;
}

const confirmed = (methods: readonly MfaMethod[], type: MfaMethod["type"]) =>
  methods.filter((method) => method.type === type && !method.pending);

/**
 * The second step of a sign-in. It opens on the authenticator app when the
 * account has one, since that needs no round trip, and offers the email code
 * and a recovery code as the other ways in.
 */
export function MfaChallengeStep({
  challenge,
  t,
  pending,
  error,
  onVerify,
  onUseTrustedDevice,
  onSendEmailCode,
  onCancel,
}: MfaChallengeStepProps) {
  const apps = confirmed(challenge.methods, "totp");
  const emails = confirmed(challenge.methods, "email");
  const email = emails[0];
  const [mode, setMode] = useState<Mode>(apps.length > 0 ? "totp" : email ? "email" : "recovery");
  const [appId, setAppId] = useState(apps[0]?.id);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const message = localError ?? error;

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (error) codeRef.current?.focus();
  }, [error]);

  const switchTo = (next: Mode) => {
    setMode(next);
    setCode("");
    setLocalError(null);
    window.setTimeout(() => codeRef.current?.focus(), 0);
  };

  const send = async () => {
    if (email === undefined || wait > 0) return;
    const seconds = await onSendEmailCode(email.id);
    if (seconds === null) return;
    setSent(true);
    setWait(seconds);
    codeRef.current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const typed = code.trim();
    if (!typed) {
      setLocalError(t("auth.mfa.codeMissing"));
      codeRef.current?.focus();
      return;
    }
    setLocalError(null);
    onVerify({
      ...(mode === "totp" ? { methodId: appId } : mode === "email" ? { methodId: email?.id } : {}),
      code: mode === "recovery" ? typed : typed.replace(/\s+/g, ""),
      rememberDevice: remember,
    });
  };

  const title =
    mode === "totp"
      ? t("auth.mfa.totpTitle")
      : mode === "email"
        ? t("auth.mfa.emailTitle")
        : t("auth.mfa.recoveryTitle");
  const description =
    mode === "totp"
      ? t("auth.mfa.totpDescription")
      : mode === "email"
        ? t("auth.mfa.emailDescription", { address: email?.emailAddress ?? "" })
        : t("auth.mfa.recoveryDescription");
  const fieldState = { invalid: Boolean(message), errorId: message ? errorId : undefined };

  return (
    <AuthFrame title={title} description={description}>
      {challenge.trustedDeviceAvailable ? (
        <div className={styles.externalBlock}>
          <button
            type="button"
            className={styles.externalLogin}
            onClick={onUseTrustedDevice}
            disabled={pending}
          >
            {t("auth.mfa.useTrustedDevice")}
          </button>
          <div className={styles.separator} aria-hidden="true">
            <span>{t("auth.mfa.orCode")}</span>
          </div>
        </div>
      ) : null}

      <form className={styles.form} onSubmit={submit} noValidate>
        {mode === "totp" && apps.length > 1 ? (
          <div className={styles.field}>
            <label htmlFor={`${errorId}-app`}>{t("auth.mfa.app")}</label>
            <select
              id={`${errorId}-app`}
              className={steps.select}
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              disabled={pending}
            >
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {mode === "email" ? (
          <button
            type="button"
            className={styles.externalLogin}
            onClick={() => void send()}
            disabled={pending || wait > 0}
          >
            {wait > 0
              ? t("auth.mfa.resendIn", { seconds: wait })
              : sent
                ? t("auth.mfa.resendEmail")
                : t("auth.mfa.sendEmail")}
          </button>
        ) : null}

        <AuthField
          ref={codeRef}
          label={mode === "recovery" ? t("auth.mfa.recoveryCode") : t("auth.mfa.code")}
          hint={mode === "email" && sent ? t("auth.mfa.emailSent") : undefined}
          name="code"
          type="text"
          inputMode={mode === "recovery" ? "text" : "numeric"}
          autoComplete={mode === "recovery" ? "off" : "one-time-code"}
          autoCapitalize={mode === "recovery" ? "characters" : "none"}
          spellCheck={false}
          maxLength={mode === "recovery" ? 64 : 8}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={pending}
          autoFocus={mode !== "email"}
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

        {message ? (
          <p className={styles.error} id={errorId} role="alert">
            {message}
          </p>
        ) : null}

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? t("auth.mfa.pending") : t("auth.mfa.submit")}
        </button>
      </form>

      <nav className={styles.links} aria-label={t("auth.mfa.otherWays")}>
        {mode !== "totp" && apps.length > 0 ? (
          <button type="button" className={styles.textLink} onClick={() => switchTo("totp")}>
            {t("auth.mfa.useTotp")}
          </button>
        ) : null}
        {mode !== "email" && email !== undefined ? (
          <button type="button" className={styles.textLink} onClick={() => switchTo("email")}>
            {t("auth.mfa.useEmail")}
          </button>
        ) : null}
        {mode !== "recovery" ? (
          <button type="button" className={styles.textLink} onClick={() => switchTo("recovery")}>
            {t("auth.mfa.useRecovery")}
          </button>
        ) : null}
        <button type="button" className={styles.textLink} onClick={onCancel}>
          {t("auth.mfa.cancel")}
        </button>
      </nav>
    </AuthFrame>
  );
}
