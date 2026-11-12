"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { AuthFrame, authStyles as styles, type StepFrame } from "@/components/auth/AuthFrame";
import type { Translator } from "@/i18n";

export interface PasswordConfirmStepProps {
  t: Translator;
  pending: boolean;
  error: string | null;
  onSubmit(password: string): void;
  /** Defaults to the sign-in page. */
  frame?: StepFrame;
  /** A way out, offered on the page; a dialog has its own close button. */
  onBack?(): void;
}

/** The password, asked again before the first second-factor method is set up. */
export function PasswordConfirmStep({
  t,
  pending,
  error,
  onSubmit,
  frame: Frame = AuthFrame,
  onBack,
}: PasswordConfirmStepProps) {
  const [password, setPassword] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !password) {
      fieldRef.current?.focus();
      return;
    }
    onSubmit(password);
  };

  return (
    <Frame title={t("security.password.title")} description={t("security.password.description")}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <AuthField
          ref={fieldRef}
          label={t("auth.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          autoFocus
          invalid={Boolean(error)}
          errorId={error ? errorId : undefined}
        />
        {error ? (
          <p className={styles.error} id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? t("auth.mfa.pending") : t("security.password.submit")}
        </button>
      </form>
      {onBack ? (
        <nav className={styles.links} aria-label={t("auth.login.options")}>
          <button type="button" className={styles.textLink} onClick={onBack}>
            {t("common.cancel")}
          </button>
        </nav>
      ) : null}
    </Frame>
  );
}
