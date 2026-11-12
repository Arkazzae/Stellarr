"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/errors";
import { leaveFor } from "@/lib/leaveFor";
import type { MessageKey } from "@/i18n";
import type { AuthResult, MfaChallenge, MfaCompletion, MfaEnrollment } from "@/ports";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

import type { EnrollMode } from "@/components/auth/MfaEnrollStep";

import { challengeErrorMessage } from "./challengeErrors";

export type SignInStep =
  | { kind: "password" }
  | { kind: "resuming" }
  | { kind: "challenge"; challenge: MfaChallenge }
  | { kind: "enroll"; challenge: MfaChallenge; mode: EnrollMode; enrollment: MfaEnrollment | null }
  | { kind: "codes"; codes: string[]; username: string }
  | { kind: "redeem" }
  /** The password, before a signed-in account sets up its first method to confirm with. */
  | { kind: "confirm-password" }
  /** A signed-in session is confirmed and may go back to where it came from. */
  | { kind: "done" };

export interface SignInFlow {
  step: SignInStep;
  pending: boolean;
  error: string | null;
  /** Seconds left before another email code during enrollment; null before the first one. */
  enrollEmailWait: number | null;
  submitPassword(username: string, password: string): Promise<void>;
  verify(input: { methodId?: string; code: string; rememberDevice: boolean }): void;
  continueOnTrustedDevice(): void;
  sendEmailCode(methodId: string): Promise<number | null>;
  setEnrollMode(mode: EnrollMode): void;
  sendEnrollEmailCode(): void;
  confirmEnrollment(input: { code: string; rememberDevice: boolean }): void;
  redeem(credential: string): void;
  finishCodes(): void;
  confirmPassword(password: string): void;
  cancel(): void;
}

const NAME_KEY: Record<EnrollMode, MessageKey> = {
  totp: "auth.enroll.totpName",
  email: "auth.enroll.emailName",
};

/**
 * Drives a sign-in from the password to a full session. Nothing boots until
 * the server has issued that session: a challenge, a first-method setup or an
 * operator recovery each stay on this page, and only `reload` at the very end
 * lets the app load, open the hub or join voice.
 *
 * On arrival it asks the server for a challenge this browser left unfinished,
 * so a reload or the return from an identity provider resumes the step instead
 * of starting over. The secret half lives in an HttpOnly cookie; nothing here
 * keeps a code, a key or a credential beyond the screen showing it.
 */
export function useSignInFlow({
  recoveryRequired = false,
  confirm = false,
}: {
  recoveryRequired?: boolean;
  /**
   * A signed-in session must pass a real second step before it goes on, as
   * Cockpit requires. One that already did goes on at once.
   */
  confirm?: boolean;
} = {}): SignInFlow {
  const ports = usePorts();
  const { login, reload, phase } = useSession();
  const { t } = useLanguage();
  const challengePort = ports.session.challenge;
  const [step, setStep] = useState<SignInStep>(recoveryRequired ? { kind: "redeem" } : { kind: "resuming" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailWaitUntil, setEmailWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const resumed = useRef(false);
  const confirming = useRef(false);
  const security = ports.security;

  const enter = useCallback((challenge: MfaChallenge) => {
    setError(null);
    setEmailWaitUntil(null);
    setStep(
      challenge.enrollment
        ? { kind: "enroll", challenge, mode: "totp", enrollment: null }
        : { kind: "challenge", challenge },
    );
  }, []);

  useEffect(() => {
    if (resumed.current || recoveryRequired || phase === "loading" || phase === "ready") return;
    let active = true;
    // Marked only once an answer is applied: if this effect is replaced first,
    // for instance by new ports after a sign-out, the next run asks again
    // instead of leaving the page waiting for an answer it threw away.
    challengePort.pending().then(
      (challenge) => {
        if (!active) return;
        resumed.current = true;
        if (challenge === null) setStep({ kind: "password" });
        else enter(challenge);
      },
      () => {
        if (!active) return;
        resumed.current = true;
        setStep({ kind: "password" });
      },
    );
    return () => {
      active = false;
    };
  }, [challengePort, enter, phase, recoveryRequired]);

  /**
   * Says what went wrong in the reader's language. A 401 can mean a wrong code
   * or a challenge that ran out; the server's pending state tells them apart,
   * and an expired one sends the visitor back to the password.
   */
  const fail = useCallback(
    async (cause: unknown, unauthorized: MessageKey = "auth.mfa.codeInvalid") => {
      if (cause instanceof ApiError && cause.status === 401) {
        const still = await challengePort.pending().catch(() => null);
        if (still === null) {
          setStep({ kind: "password" });
          setError(t("auth.mfa.expired"));
          return;
        }
        setError(t(unauthorized));
        return;
      }
      setError(challengeErrorMessage(cause, t, t("auth.mfa.failed")));
    },
    [challengePort, t],
  );

  // A signed-in session asked to confirm: it goes on at once if it already
  // passed a real second step, else it proves one now, or sets up the first
  // method when the account has none.
  useEffect(() => {
    if (!confirm || phase !== "ready" || confirming.current) return;
    confirming.current = true;
    void (async () => {
      try {
        const state = await security.get();
        if (state.mfaCompletedAt !== undefined && state.mfaEvidence !== "trusted_device") {
          setStep({ kind: "done" });
          return;
        }
        if (state.methods.some((method) => !method.pending)) {
          enter(await security.startReverification());
          return;
        }
        try {
          enter(await security.startEnrollment());
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 403) setStep({ kind: "confirm-password" });
          else throw cause;
        }
      } catch (cause) {
        setStep({ kind: "password" });
        setError(challengeErrorMessage(cause, t, t("auth.mfa.failed")));
      }
    })();
  }, [confirm, enter, phase, security, t]);

  // A setup by authenticator app needs its key before anything can be typed.
  const enrollChallengeId =
    step.kind === "enroll" && step.mode === "totp" && step.enrollment === null
      ? step.challenge.challengeId
      : null;
  useEffect(() => {
    if (enrollChallengeId === null) return;
    let active = true;
    challengePort.startTotp(enrollChallengeId, t(NAME_KEY.totp)).then(
      (enrollment) => {
        if (!active) return;
        setStep((current) =>
          current.kind === "enroll" && current.challenge.challengeId === enrollChallengeId
            ? { ...current, enrollment }
            : current,
        );
      },
      (cause: unknown) => active && void fail(cause),
    );
    return () => {
      active = false;
    };
  }, [challengePort, enrollChallengeId, fail, t]);

  useEffect(() => {
    if (emailWaitUntil === null || emailWaitUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [emailWaitUntil]);

  const complete = useCallback(
    (completion: MfaCompletion) => {
      if (completion.recoveryCodes !== undefined && completion.recoveryCodes.length > 0) {
        setStep({ kind: "codes", codes: completion.recoveryCodes, username: completion.user.username });
        return;
      }
      if (confirm && phase === "ready") setStep({ kind: "done" });
      else reload();
    },
    [confirm, phase, reload],
  );

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setPending(true);
      setError(null);
      try {
        await action();
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const follow = useCallback(
    (result: AuthResult | null) => {
      if (result === null || result.kind === "signed-in") return;
      if (result.kind === "recovery-required") {
        setStep({ kind: "redeem" });
        return;
      }
      enter(result.challenge);
    },
    [enter],
  );

  const currentChallenge = step.kind === "challenge" || step.kind === "enroll" ? step.challenge : null;

  return {
    step,
    pending,
    error,
    enrollEmailWait:
      emailWaitUntil === null ? null : Math.max(0, Math.ceil((emailWaitUntil - now) / 1000)),

    async submitPassword(username, password) {
      setError(null);
      follow(await login(username, password));
    },

    verify(input) {
      if (currentChallenge === null) return;
      void run(async () => {
        try {
          complete(await challengePort.verify({ challengeId: currentChallenge.challengeId, ...input }));
        } catch (cause) {
          await fail(cause);
        }
      });
    },

    continueOnTrustedDevice() {
      if (currentChallenge === null) return;
      void run(async () => {
        try {
          complete(
            await challengePort.verify({
              challengeId: currentChallenge.challengeId,
              useTrustedDevice: true,
            }),
          );
        } catch (cause) {
          await fail(cause, "auth.mfa.failed");
        }
      });
    },

    async sendEmailCode(methodId) {
      if (currentChallenge === null) return null;
      setError(null);
      try {
        const { retryAfterSeconds } = await challengePort.sendEmailCode(
          currentChallenge.challengeId,
          methodId,
        );
        return retryAfterSeconds;
      } catch (cause) {
        await fail(cause, "auth.mfa.failed");
        return null;
      }
    },

    setEnrollMode(mode) {
      setError(null);
      setStep((current) =>
        current.kind === "enroll" ? { ...current, mode, enrollment: null } : current,
      );
    },

    sendEnrollEmailCode() {
      if (currentChallenge === null) return;
      void run(async () => {
        try {
          const { retryAfterSeconds } = await challengePort.startEmail(
            currentChallenge.challengeId,
            t(NAME_KEY.email),
          );
          setNow(Date.now());
          setEmailWaitUntil(Date.now() + retryAfterSeconds * 1000);
        } catch (cause) {
          await fail(cause, "auth.mfa.failed");
        }
      });
    },

    confirmEnrollment({ code, rememberDevice }) {
      if (step.kind !== "enroll") return;
      const { challenge, mode, enrollment } = step;
      void run(async () => {
        try {
          complete(
            mode === "totp" && enrollment !== null
              ? await challengePort.confirmTotp({
                  challengeId: challenge.challengeId,
                  methodId: enrollment.methodId,
                  code,
                  name: t(NAME_KEY.totp),
                  rememberDevice,
                })
              : await challengePort.confirmEmail({
                  challengeId: challenge.challengeId,
                  code,
                  name: t(NAME_KEY.email),
                  rememberDevice,
                }),
          );
        } catch (cause) {
          await fail(cause);
        }
      });
    },

    redeem(credential) {
      void run(async () => {
        try {
          enter(await challengePort.redeemRecovery(credential));
        } catch (cause) {
          if (cause instanceof ApiError && (cause.status === 401 || cause.status === 400)) {
            setError(t("auth.recover.invalid"));
          } else {
            await fail(cause, "auth.recover.invalid");
          }
        }
      });
    },

    finishCodes() {
      if (confirm && phase === "ready") setStep({ kind: "done" });
      else reload();
    },

    confirmPassword(password) {
      void run(async () => {
        try {
          enter(await security.startEnrollment(password));
        } catch (cause) {
          setError(
            cause instanceof ApiError && cause.status === 403
              ? t("security.password.wrong")
              : challengeErrorMessage(cause, t, t("auth.mfa.failed")),
          );
        }
      });
    },

    cancel() {
      if (confirm && phase === "ready") {
        // Signed in already: giving up the confirmation goes back to the app.
        void challengePort.cancel().catch(() => undefined);
        leaveFor("/");
        return;
      }
      setError(null);
      setStep({ kind: "password" });
      void challengePort.cancel().catch(() => undefined);
    },
  };
}
