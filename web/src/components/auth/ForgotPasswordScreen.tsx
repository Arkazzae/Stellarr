"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { translateMessage, type Translator } from "@/i18n";

import { AuthField } from "./AuthField";
import { AuthFrame, authStyles as styles } from "./AuthFrame";

export function ForgotPasswordScreen({
  onSubmit,
  t = (key, values) => translateMessage("pl", key, values),
}: {
  onSubmit: (email: string) => Promise<void>;
  t?: Translator;
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !email.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(email.trim());
      setSent(true);
    } catch {
      setError(t("auth.forgot.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame title={t("auth.forgot.title")} description={t("auth.forgot.description")}>
      {sent ? (
        <p className={styles.success} role="status">
          {t("auth.forgot.sent")}
        </p>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <AuthField
            label={t("auth.email")}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
            required
          />
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button className={styles.submit} type="submit" disabled={pending || !email.trim()}>
            {pending ? t("auth.forgot.pending") : t("auth.forgot.submit")}
          </button>
        </form>
      )}
      <nav className={styles.links} aria-label={t("auth.register.returnLabel")}>
        <Link className={styles.textLink} href="/login">
          {t("auth.forgot.return")}
        </Link>
      </nav>
    </AuthFrame>
  );
}
