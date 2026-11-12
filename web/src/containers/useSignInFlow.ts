"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/errors";
import type { MessageKey } from "@/i18n";
import type { AuthResult, MfaChallenge, MfaCompletion, MfaEnrollment } from "@/ports";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

import type { EnrollMode } from "@/components/auth/MfaEnrollStep";

export type SignInStep =
  | { kind: "password" }
  | { kind: "resuming" }
  | { kind: "challenge"; challenge: MfaChallenge }
  | { kind: "enroll"; challenge: MfaChallenge; mode: EnrollMode; enrollment: MfaEnrollment | null }
  | { kind: "codes"; codes: string[]; username: string }
  | { kind: "redeem" };

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
  cancel(): void;
}

const NAME_KEY: Record<EnrollMode, MessageKey> = {
  totp: "auth.enroll.totpName",
  email: "auth.enroll.emailName",
};

const retryAfterOf = (cause: unknown): number | null => {
  const seconds = cause instanceof ApiError ? cause.details?.["retryAfterSeconds"] : undefined;
  return typeof seconds === "number" ? seconds : null;
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
export function useSignInFlow({ recoveryRequired = false }: { recoveryRequired?: boolean } = {}): SignInFlow {
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
    resumed.current = true;
    let active = true;
    challengePort.pending().then(
      (challenge) => {
        if (!active) return;
        if (challenge === null) setStep({ kind: "password" });
        else enter(challenge);
      },
      () => active && setStep({ kind: "password" }),
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
      if (cause instanceof ApiError && cause.status === 429) {
        const seconds = retryAfterOf(cause);
        setError(
          seconds !== null && seconds < 600
            ? t("auth.mfa.emailCooldown", { seconds })
            : t("auth.mfa.tooMany"),
        );
        return;
      }
      if (cause instanceof ApiError && cause.status === 409) {
        setError(t("auth.mfa.emailUnavailable"));
        return;
      }
      if (cause instanceof ApiError && cause.status === 502) {
        setError(t("auth.mfa.deliveryFailed"));
        return;
      }
      setError(t("auth.mfa.failed"));
    },
    [challengePort, t],
  );

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
      reload();
    },
    [reload],
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
      reload();
    },

    cancel() {
      setError(null);
      setStep({ kind: "password" });
      void challengePort.cancel().catch(() => undefined);
    },
  };
}
