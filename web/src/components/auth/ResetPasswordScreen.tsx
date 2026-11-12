"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { type Translator } from "@/i18n";
import { translateForDocument } from "@/i18n/defaultLocale";

import { AuthField } from "./AuthField";
import { AuthFrame, authStyles as styles } from "./AuthFrame";

export function ResetPasswordScreen({
  token,
  onSubmit,
  t = translateForDocument,
}: {
  token: string;
  onSubmit: (token: string, password: string) => Promise<void>;
  t?: Translator;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (password.length < 8) {
      setError(t("auth.password.tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.password.mismatch"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(token, password);
      setChanged(true);
      setPassword("");
      setConfirm("");
    } catch {
      setError(t("auth.reset.invalid"));
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthFrame
        title={t("auth.reset.missingTitle")}
        description={t("auth.reset.missingDescription")}
      >
        <Link className={styles.textLink} href="/forgot-password">
          {t("auth.reset.newLink")}
        </Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={t("auth.reset.title")} description={t("auth.reset.description")}>
      {changed ? (
        <>
          <p className={styles.success} role="status">
            {t("auth.reset.success")}
          </p>
          <nav className={styles.links}>
            <Link className={styles.textLink} href="/login">
              {t("auth.reset.goLogin")}
            </Link>
          </nav>
        </>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <AuthField
            label={t("auth.reset.newPassword")}
            hint={t("auth.reset.passwordHint")}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
          <AuthField
            label={t("auth.reset.confirmPassword")}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={pending}
            invalid={confirm.length > 0 && confirm !== password}
          />
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button className={styles.submit} type="submit" disabled={pending}>
            {pending ? t("auth.reset.pending") : t("auth.reset.submit")}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
