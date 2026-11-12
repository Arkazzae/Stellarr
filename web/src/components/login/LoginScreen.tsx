"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { AuthFrame, authStyles as styles } from "@/components/auth/AuthFrame";
import { type Translator } from "@/i18n";
import { translateForDocument } from "@/i18n/defaultLocale";

export interface LoginScreenProps {
  onSubmit: (username: string, password: string) => void;
  pending?: boolean;
  error?: string | null;
  /** True while the existing session is being checked; the form is not offered yet. */
  checking?: boolean;
  t?: Translator;
  /** Desktop disables Chromium's password-store prompt; web keeps normal autofill. */
  passwordAutoComplete?: "current-password" | "new-password";
  /** The native broker owns credentials, so CEF must not classify the field for its password UI. */
  nativeCredentialBroker?: boolean;
  /** Optional contextual action shown immediately above the login heading. */
  headingAction?: ReactNode;
  /** A link when `href` is given, a button when `onClick` is. */
  externalLogin?: {
    href?: string;
    label: string;
    onClick?: () => void;
    pending?: boolean;
  };
  externalError?: string | null;
  /**
   * "Keep me signed in", shown when given. The page holds the choice so the
   * identity provider's link carries it too.
   */
  keepSignedIn?: { checked: boolean; onChange: (checked: boolean) => void };
  /** Signing in with a passkey alone, shown when given; the desktop app passes none. */
  passkeyLogin?: { label: string; onClick: () => void; pending?: boolean };
}

export function LoginScreen({
  onSubmit,
  pending = false,
  error = null,
  checking = false,
  t = translateForDocument,
  passwordAutoComplete = "current-password",
  nativeCredentialBroker = false,
  headingAction,
  externalLogin,
  externalError = null,
  keepSignedIn,
  passkeyLogin,
}: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const message = localError ?? error ?? externalError;
  const fieldState = { invalid: Boolean(message), errorId: message ? errorId : undefined };

  useEffect(() => {
    if (checking) return;
    // A desktop user can type at once. On a phone the same focus would open the
    // software keyboard before the screen is read, covering the password field
    // and the recovery link.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      usernameRef.current?.focus();
    }
  }, [checking]);

  useEffect(() => {
    if (error) usernameRef.current?.focus();
  }, [error]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!username.trim() || !password) {
      setLocalError(t("auth.login.missing"));
      usernameRef.current?.focus();
      return;
    }
    setLocalError(null);
    onSubmit(username.trim(), password);
  };

  return (
    <AuthFrame
      title={t("auth.login.title")}
      description={t("auth.login.description")}
      headingAction={headingAction}
    >
      {checking ? (
        <p className={styles.checking} aria-busy="true">
          {t("auth.login.checking")}
        </p>
      ) : (
        <>
          {externalLogin || passkeyLogin ? (
            <div className={styles.externalBlock}>
              {passkeyLogin ? (
                <button
                  className={styles.externalLogin}
                  type="button"
                  onClick={passkeyLogin.onClick}
                  disabled={pending || passkeyLogin.pending}
                >
                  {passkeyLogin.label}
                </button>
              ) : null}
              {externalLogin === undefined ? null : externalLogin.onClick ? (
                <button
                  className={styles.externalLogin}
                  type="button"
                  onClick={externalLogin.onClick}
                  disabled={externalLogin.pending}
                >
                  {externalLogin.label}
                </button>
              ) : (
                <a className={styles.externalLogin} href={externalLogin.href}>
                  {externalLogin.label}
                </a>
              )}
              <div className={styles.separator} aria-hidden="true">
                <span>{t("auth.login.orPassword")}</span>
              </div>
            </div>
          ) : null}
          <form className={styles.form} onSubmit={submit} noValidate>
            <AuthField
              ref={usernameRef}
              label={t("auth.login.identifier")}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={pending}
              {...fieldState}
            />
            <AuthField
              label={t("auth.password")}
              name="password"
              type={nativeCredentialBroker ? "text" : "password"}
              autoComplete={nativeCredentialBroker ? "off" : passwordAutoComplete}
              className={nativeCredentialBroker ? styles.nativePassword : undefined}
              data-1p-ignore={nativeCredentialBroker || undefined}
              data-lpignore={nativeCredentialBroker || undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              {...fieldState}
            />

            {keepSignedIn ? (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  name="keepSignedIn"
                  checked={keepSignedIn.checked}
                  onChange={(event) => keepSignedIn.onChange(event.target.checked)}
                  disabled={pending}
                />
                <span>{t("auth.login.keepSignedIn")}</span>
              </label>
            ) : null}

            {message ? (
              <p className={styles.error} id={errorId} role="alert">
                {message}
              </p>
            ) : null}

            <button type="submit" className={styles.submit} disabled={pending}>
              {pending ? t("auth.login.pending") : t("auth.login.submit")}
            </button>
          </form>

          <nav className={styles.links} aria-label={t("auth.login.options")}>
            <Link className={styles.textLink} href="/forgot-password">
              {t("auth.login.forgot")}
            </Link>
            <Link className={styles.textLink} href="/register">
              {t("auth.login.register")}
            </Link>
          </nav>
        </>
      )}
    </AuthFrame>
  );
}
