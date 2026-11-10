"use client";

import Link from "next/link";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import { translateMessage, type Translator } from "@/i18n";
import type { RegistrationInput } from "@/ports";

import { AuthField } from "./AuthField";
import { AuthFrame, authStyles as styles } from "./AuthFrame";

/** Each value is also the `name` of its input, which is how focus finds it. */
type Field = "displayName" | "username" | "email" | "password" | "confirmPassword";
type Values = Record<Field, string>;

interface Issue {
  message: string;
  /** Null when the server refused the whole form rather than one field. */
  field: Field | null;
}

const EMPTY: Values = {
  displayName: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
};

/** Checks in visual order, so repeated submits walk down the form. */
function firstProblem(values: Values, t: Translator): (Issue & { field: Field }) | null {
  if (!values.displayName.trim()) {
    return { field: "displayName", message: t("auth.register.missingProfile") };
  }
  if (values.username.trim().length < 3) {
    return { field: "username", message: t("auth.register.usernameTooShort") };
  }
  if (!values.email.trim()) {
    return { field: "email", message: t("auth.register.missingProfile") };
  }
  if (values.password.length < 8) {
    return { field: "password", message: t("auth.password.tooShort") };
  }
  if (values.password !== values.confirmPassword) {
    return { field: "confirmPassword", message: t("auth.password.mismatch") };
  }
  return null;
}

function focusField(form: HTMLFormElement, field: Field): void {
  const input = form.elements.namedItem(field);
  if (input instanceof HTMLInputElement) input.focus();
}

export function RegisterScreen({
  onSubmit,
  t = (key, values) => translateMessage("pl", key, values),
}: {
  /** Resolves to whether the account was created. */
  onSubmit: (input: RegistrationInput) => Promise<boolean>;
  t?: Translator;
}) {
  const errorId = useId();
  const [values, setValues] = useState<Values>(EMPTY);
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState<Issue | null>(null);

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  };

  const flagged = (field: Field) => issue?.field === field;
  const status = (field: Field) => ({
    invalid: flagged(field),
    errorId: flagged(field) ? errorId : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // On a phone the offending field may be several viewports above the
    // submit button, so focus doubles as the scroll target.
    const problem = firstProblem(values, t);
    if (problem) {
      setIssue(problem);
      focusField(event.currentTarget, problem.field);
      return;
    }

    setPending(true);
    setIssue(null);
    const created = await onSubmit({
      username: values.username.trim(),
      displayName: values.displayName.trim(),
      email: values.email.trim(),
      password: values.password,
    }).catch(() => false);
    if (!created) setIssue({ field: null, message: t("auth.register.failed") });
    setPending(false);
  }

  return (
    <AuthFrame title={t("auth.register.title")} description={t("auth.register.description")}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <AuthField
          label={t("auth.register.displayName")}
          name="displayName"
          autoComplete="name"
          maxLength={64}
          value={values.displayName}
          onChange={change}
          disabled={pending}
          {...status("displayName")}
        />
        <AuthField
          label={t("auth.register.username")}
          hint={t("auth.register.usernameHint")}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={3}
          maxLength={32}
          value={values.username}
          onChange={change}
          disabled={pending}
          {...status("username")}
        />
        <AuthField
          label={t("auth.email")}
          hint={t("auth.register.emailHint")}
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={change}
          disabled={pending}
          {...status("email")}
        />
        <AuthField
          label={t("auth.password")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={values.password}
          onChange={change}
          disabled={pending}
          {...status("password")}
        />
        <AuthField
          label={t("auth.register.confirmPassword")}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={change}
          disabled={pending}
          invalid={
            flagged("confirmPassword") ||
            (values.confirmPassword.length > 0 && values.confirmPassword !== values.password)
          }
          errorId={flagged("confirmPassword") ? errorId : undefined}
        />
        {issue ? (
          <p id={errorId} className={styles.error} role="alert">
            {issue.message}
          </p>
        ) : null}
        <button className={styles.submit} type="submit" disabled={pending}>
          {pending ? t("auth.register.pending") : t("auth.register.submit")}
        </button>
      </form>
      <nav className={styles.links} aria-label={t("auth.register.returnLabel")}>
        <span>{t("auth.register.haveAccount")}</span>
        <Link className={styles.textLink} href="/login">
          {t("auth.login.submit")}
        </Link>
      </nav>
    </AuthFrame>
  );
}
