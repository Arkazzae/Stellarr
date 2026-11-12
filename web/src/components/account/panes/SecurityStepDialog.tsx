"use client";

import { createContext, useContext, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { authStyles as styles } from "@/components/auth/AuthFrame";
import { MfaChallengeStep } from "@/components/auth/MfaChallengeStep";
import { MfaEnrollStep, type EnrollMode } from "@/components/auth/MfaEnrollStep";
import { QrCode } from "@/components/auth/QrCode";
import { RecoveryCodesStep } from "@/components/auth/RecoveryCodesStep";
import { Modal } from "@/components/primitives/Modal";
import { DialogHeader } from "@/components/settings/DialogHeader";
import type { Translator } from "@/i18n";
import type { MfaChallenge, MfaEnrollment } from "@/ports";

export type SecurityDialogStep =
  | { kind: "password" }
  | { kind: "reverify"; challenge: MfaChallenge }
  | { kind: "enroll"; challenge: MfaChallenge; mode: EnrollMode; enrollment: MfaEnrollment | null }
  | { kind: "codes"; codes: string[] };

export interface SecurityStepDialogProps {
  step: SecurityDialogStep | null;
  username: string;
  t: Translator;
  pending: boolean;
  error: string | null;
  emailRetryAfter: number | null;
  onPassword(password: string): void;
  onVerify(input: { methodId?: string; code: string; rememberDevice: boolean }): void;
  onSendEmailCode(methodId: string): Promise<number | null>;
  onEnrollModeChange(mode: EnrollMode): void;
  onSendEnrollEmailCode(): void;
  onConfirmEnrollment(input: { code: string; rememberDevice: boolean; name?: string }): void;
  onClose(): void;
}

const DialogContext = createContext<{ titleId: string; onClose: () => void }>({
  titleId: "",
  onClose: () => undefined,
});

/** The sign-in steps, drawn as a settings dialog instead of a page. */
function DialogStepFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { titleId, onClose } = useContext(DialogContext);
  return (
    <div className="am-card sec-step">
      <DialogHeader titleId={titleId} title={title} detail={description} onClose={onClose} />
      <div className="dlg-body">{children}</div>
    </div>
  );
}

function PasswordStep({
  t,
  pending,
  error,
  onSubmit,
}: {
  t: Translator;
  pending: boolean;
  error: string | null;
  onSubmit(password: string): void;
}) {
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
    <DialogStepFrame title={t("security.password.title")} description={t("security.password.description")}>
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
    </DialogStepFrame>
  );
}

/**
 * The proof and setup steps a change to the account's security runs through:
 * the password before a first method, a fresh code before any other change,
 * the setup itself and the recovery codes it issues.
 */
export function SecurityStepDialog({
  step,
  username,
  t,
  pending,
  error,
  emailRetryAfter,
  onPassword,
  onVerify,
  onSendEmailCode,
  onEnrollModeChange,
  onSendEnrollEmailCode,
  onConfirmEnrollment,
  onClose,
}: SecurityStepDialogProps) {
  const titleId = useId();

  return (
    <Modal open={step !== null} onClose={onClose} labelledBy={titleId} className="act-modal sec-dialog" exitMs={200}>
      <DialogContext.Provider value={{ titleId, onClose }}>
        {step?.kind === "password" ? (
          <PasswordStep t={t} pending={pending} error={error} onSubmit={onPassword} />
        ) : step?.kind === "reverify" ? (
          <MfaChallengeStep
            challenge={step.challenge}
            t={t}
            pending={pending}
            error={error}
            onVerify={onVerify}
            onUseTrustedDevice={() => undefined}
            onSendEmailCode={onSendEmailCode}
            onCancel={onClose}
            frame={DialogStepFrame}
            offerTrust={false}
            cancelLabel={t("common.cancel")}
          />
        ) : step?.kind === "enroll" ? (
          <MfaEnrollStep
            challenge={step.challenge}
            t={t}
            mode={step.mode}
            enrollment={step.enrollment}
            emailRetryAfter={emailRetryAfter}
            pending={pending}
            error={error}
            qr={
              step.enrollment?.otpAuthUri === undefined ? undefined : (
                <QrCode value={step.enrollment.otpAuthUri} label={t("auth.enroll.qrLabel")} />
              )
            }
            onModeChange={onEnrollModeChange}
            onSendEmailCode={onSendEnrollEmailCode}
            onConfirm={onConfirmEnrollment}
            onCancel={onClose}
            frame={DialogStepFrame}
            voluntary
            cancelLabel={t("common.cancel")}
          />
        ) : step?.kind === "codes" ? (
          <RecoveryCodesStep
            codes={step.codes}
            username={username}
            t={t}
            onDone={onClose}
            frame={DialogStepFrame}
            doneLabel={t("security.codesDone")}
          />
        ) : null}
      </DialogContext.Provider>
    </Modal>
  );
}
