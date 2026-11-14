"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { EnrollMode } from "@/components/auth/MfaEnrollStep";
import type { SecurityDialogStep } from "@/components/account/panes/SecurityStepDialog";
import type { MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { leaveFor } from "@/lib/leaveFor";
import { PasskeyCancelledError } from "@/lib/webauthn";
import type {
  AccountSecurity,
  IdentityProvider,
  LinkedIdentity,
  MfaChallenge,
  MfaCompletion,
  MfaMethod,
  OwnSession,
  TrustedDevice,
} from "@/ports";
import { useLanguage, usePorts } from "@/state/hooks";

import { challengeErrorMessage } from "./challengeErrors";

/** What to do once the proof it needed is in hand. */
type Change =
  /** Starts on the way the person picked in the pane, the app's when none was. */
  | { kind: "enroll"; mode?: EnrollMode }
  | { kind: "remove"; methodId: string }
  | { kind: "regenerate" }
  /** Linking ends on the provider's page, after a full page load. */
  | { kind: "link"; providerId: string }
  | { kind: "unlink"; identityId: string };

const NAME_KEY: Record<EnrollMode, MessageKey> = {
  totp: "auth.enroll.totpName",
  email: "auth.enroll.emailName",
  passkey: "auth.enroll.passkeyName",
};

const noSubscription = () => () => undefined;

const isForbidden = (cause: unknown) => cause instanceof ApiError && cause.status === 403;

/**
 * The account's second factor in the settings: its state, and the steps a
 * change runs through. A change is tried first; when the server answers 403
 * the proof it wants is asked for (the password before the first method, a
 * fresh code after that) and the change is tried again with it.
 */
export function useAccountSecurity(open: boolean) {
  const ports = usePorts();
  const { t } = useLanguage();
  const security = ports.security;
  const challenges = ports.session.challenge;
  const [state, setState] = useState<AccountSecurity | null>(null);
  const [sessions, setSessions] = useState<OwnSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SecurityDialogStep | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailWait, setEmailWait] = useState<number | null>(null);
  const change = useRef<Change | null>(null);
  /** Waits for a proof asked for on its own, outside any change here. */
  const proof = useRef<((passed: boolean) => void) | null>(null);
  const passkeysSupported = useSyncExternalStore(
    noSubscription,
    () => ports.session.passkeysSupported(),
    () => false,
  );

  const refresh = useCallback(async () => {
    try {
      const [next, devices] = await Promise.all([security.get(), security.listSessions()]);
      setState(next);
      setSessions(devices);
      setLoadError(null);
    } catch {
      setLoadError(t("security.loadFailed"));
    }
  }, [security, t]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([security.get(), security.listSessions()]).then(
      ([next, devices]) => {
        if (!active) return;
        setState(next);
        setSessions(devices);
        setLoadError(null);
      },
      () => active && setLoadError(t("security.loadFailed")),
    );
    return () => {
      active = false;
    };
  }, [open, security, t]);

  useEffect(() => {
    if (emailWait === null || emailWait <= 0) return;
    const timer = window.setTimeout(() => setEmailWait((seconds) => (seconds ?? 1) - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [emailWait]);

  // A setup by authenticator app needs its key before anything can be typed.
  const enrollChallengeId =
    step?.kind === "enroll" && step.mode === "totp" && step.enrollment === null
      ? step.challenge.challengeId
      : null;
  useEffect(() => {
    if (enrollChallengeId === null) return;
    let active = true;
    challenges.startTotp(enrollChallengeId, t(NAME_KEY.totp)).then(
      (enrollment) => {
        if (!active) return;
        setStep((current) =>
          current?.kind === "enroll" && current.challenge.challengeId === enrollChallengeId
            ? { ...current, enrollment }
            : current,
        );
      },
      (cause: unknown) => active && setError(challengeErrorMessage(cause, t, t("security.actionFailed"))),
    );
    return () => {
      active = false;
    };
  }, [challenges, enrollChallengeId, t]);

  const hasMethod = (state?.methods ?? []).some((method) => !method.pending);

  const finish = useCallback(
    async (codes?: string[]) => {
      change.current = null;
      setError(null);
      setStep(codes !== undefined && codes.length > 0 ? { kind: "codes", codes } : null);
      await refresh();
    },
    [refresh],
  );

  /** Runs the change waiting for proof. `password` is given only after the password step. */
  const apply = useCallback(
    async (password?: string) => {
      const next = change.current;
      if (next === null) return;
      setBusy(true);
      setActionError(null);
      try {
        if (next.kind === "enroll") {
          const challenge: MfaChallenge = await security.startEnrollment(password);
          setError(null);
          setEmailWait(null);
          setStep({ kind: "enroll", challenge, mode: next.mode ?? "totp", enrollment: null });
          return;
        }
        if (next.kind === "remove") {
          await security.removeMethod(next.methodId, password);
          await finish();
          return;
        }
        if (next.kind === "link") {
          const address = await security.startIdentityLink(next.providerId, password);
          change.current = null;
          setStep(null);
          leaveFor(address);
          return;
        }
        if (next.kind === "unlink") {
          await security.removeIdentity(next.identityId, password);
          await finish();
          return;
        }
        await finish(await security.regenerateRecoveryCodes(password));
      } catch (cause) {
        if (isForbidden(cause)) {
          if (password !== undefined) {
            setError(t("security.password.wrong"));
            return;
          }
          if (hasMethod) {
            try {
              setError(null);
              setStep({ kind: "reverify", challenge: await security.startReverification() });
            } catch (reverifyCause) {
              setStep(null);
              setActionError(challengeErrorMessage(reverifyCause, t, t("security.actionFailed")));
            }
          } else {
            setError(null);
            setStep({ kind: "password" });
          }
          return;
        }
        if (cause instanceof ApiError && cause.status === 409 && next.kind === "remove") {
          setStep(null);
          setActionError(t("security.method.lastRequired"));
          return;
        }
        setStep(null);
        setActionError(challengeErrorMessage(cause, t, t("security.actionFailed")));
      } finally {
        setBusy(false);
      }
    },
    [finish, hasMethod, security, t],
  );

  const start = (next: Change) => {
    change.current = next;
    void apply();
  };

  const runStep = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } finally {
      setPending(false);
    }
  };

  /** A closed prompt is not a wrong key; a refusal by the server is. */
  const passkeyMessage = (cause: unknown) =>
    cause instanceof PasskeyCancelledError
      ? t("auth.passkey.cancelled")
      : cause instanceof ApiError && cause.status === 401
        ? t("auth.passkey.rejected")
        : cause instanceof ApiError && cause.status === 409
          ? t("auth.passkey.unavailable")
          : challengeErrorMessage(cause, t, t("security.actionFailed"));

  const completed = async (completion: MfaCompletion, afterProof: boolean) => {
    if (afterProof && proof.current !== null) {
      const passed = proof.current;
      proof.current = null;
      setStep(null);
      passed(true);
      return;
    }
    if (afterProof) {
      // The proof is fresh now; the change it was for goes through.
      setStep(null);
      await apply();
      return;
    }
    await finish(completion.recoveryCodes);
  };

  /**
   * A fresh second step for a change made elsewhere, such as the password.
   * Resolves true once it is passed and false when the dialog is closed.
   */
  const confirmSecondStep = () =>
    new Promise<boolean>((resolve) => {
      proof.current?.(false);
      proof.current = resolve;
      change.current = null;
      setError(null);
      security.startReverification().then(
        (challenge) => setStep({ kind: "reverify", challenge }),
        (cause: unknown) => {
          proof.current = null;
          setActionError(challengeErrorMessage(cause, t, t("security.actionFailed")));
          resolve(false);
        },
      );
    });

  return {
    confirmSecondStep,
    sections: {
      security: state,
      loadError,
      actionError,
      busy,
      onAddMethod: (mode?: EnrollMode) => start({ kind: "enroll", ...(mode ? { mode } : {}) }),
      onRemoveMethod: (method: MfaMethod) => start({ kind: "remove", methodId: method.id }),
      onRegenerateCodes: () => start({ kind: "regenerate" }),
      onLinkIdentity: (provider: IdentityProvider) => start({ kind: "link", providerId: provider.id }),
      onUnlinkIdentity: (identity: LinkedIdentity) => start({ kind: "unlink", identityId: identity.id }),
      sessions,
      onRevokeSession: (session: OwnSession) => {
        setBusy(true);
        setActionError(null);
        security
          .revokeSession(session.id)
          .then(refresh, () => setActionError(t("security.actionFailed")))
          .finally(() => setBusy(false));
      },
      onRevokeOtherSessions: () => {
        setBusy(true);
        setActionError(null);
        security
          .revokeOtherSessions()
          .then(refresh, () => setActionError(t("security.actionFailed")))
          .finally(() => setBusy(false));
      },
      onRevokeDevice: (device: TrustedDevice) => {
        setBusy(true);
        setActionError(null);
        security
          .revokeTrustedDevice(device.id)
          .then(refresh, () => setActionError(t("security.actionFailed")))
          .finally(() => setBusy(false));
      },
    },
    dialog: {
      step,
      pending,
      error,
      emailRetryAfter: emailWait,
      onPassword: (password: string) => void runStep(() => apply(password)),
      onVerify: (input: { methodId?: string; code: string; rememberDevice: boolean }) => {
        if (step?.kind !== "reverify") return;
        const { challengeId } = step.challenge;
        void runStep(async () => {
          try {
            await completed(await challenges.verify({ challengeId, ...input, rememberDevice: false }), true);
          } catch (cause) {
            setError(
              cause instanceof ApiError && cause.status === 401
                ? t("auth.mfa.codeInvalid")
                : challengeErrorMessage(cause, t, t("security.actionFailed")),
            );
          }
        });
      },
      onSendEmailCode: async (methodId: string) => {
        if (step?.kind !== "reverify") return null;
        setError(null);
        try {
          return (await challenges.sendEmailCode(step.challenge.challengeId, methodId)).retryAfterSeconds;
        } catch (cause) {
          setError(challengeErrorMessage(cause, t, t("security.actionFailed")));
          return null;
        }
      },
      onEnrollModeChange: (mode: EnrollMode) => {
        setError(null);
        setStep((current) => (current?.kind === "enroll" ? { ...current, mode, enrollment: null } : current));
      },
      onSendEnrollEmailCode: () => {
        if (step?.kind !== "enroll") return;
        const { challengeId } = step.challenge;
        void runStep(async () => {
          try {
            const { retryAfterSeconds } = await challenges.startEmail(challengeId, t(NAME_KEY.email));
            setEmailWait(retryAfterSeconds);
          } catch (cause) {
            setError(challengeErrorMessage(cause, t, t("security.actionFailed")));
          }
        });
      },
      onConfirmEnrollment: ({
        code,
        rememberDevice,
        name,
      }: {
        code: string;
        rememberDevice: boolean;
        name?: string;
      }) => {
        if (step?.kind !== "enroll") return;
        const { challenge, mode, enrollment } = step;
        void runStep(async () => {
          try {
            await completed(
              mode === "totp" && enrollment !== null
                ? await challenges.confirmTotp({
                    challengeId: challenge.challengeId,
                    methodId: enrollment.methodId,
                    code,
                    name: name ?? t(NAME_KEY.totp),
                    rememberDevice,
                  })
                : await challenges.confirmEmail({
                    challengeId: challenge.challengeId,
                    code,
                    name: name ?? t(NAME_KEY.email),
                    rememberDevice,
                  }),
              false,
            );
          } catch (cause) {
            setError(
              cause instanceof ApiError && cause.status === 401
                ? t("auth.mfa.codeInvalid")
                : challengeErrorMessage(cause, t, t("security.actionFailed")),
            );
          }
        });
      },
      passkeysSupported,
      onAnswerWithPasskey: () => {
        if (step?.kind !== "reverify") return;
        const { challengeId } = step.challenge;
        void runStep(async () => {
          try {
            // A proof before a change never trusts the device.
            await completed(await challenges.answerWithPasskey({ challengeId }), true);
          } catch (cause) {
            setError(passkeyMessage(cause));
          }
        });
      },
      onCreatePasskey: ({ rememberDevice, name }: { rememberDevice: boolean; name?: string }) => {
        if (step?.kind !== "enroll") return;
        const { challengeId } = step.challenge;
        void runStep(async () => {
          try {
            await completed(
              await challenges.createPasskey({
                challengeId,
                name: name ?? t(NAME_KEY.passkey),
                rememberDevice,
              }),
              false,
            );
          } catch (cause) {
            setError(passkeyMessage(cause));
          }
        });
      },
      onClose: () => {
        proof.current?.(false);
        proof.current = null;
        if (step?.kind === "enroll" || step?.kind === "reverify") {
          void challenges.cancel().catch(() => undefined);
        }
        change.current = null;
        setStep(null);
        setError(null);
      },
    },
  };
}
