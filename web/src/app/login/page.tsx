"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { MfaChallengeStep } from "@/components/auth/MfaChallengeStep";
import { MfaEnrollStep } from "@/components/auth/MfaEnrollStep";
import { PasswordConfirmStep } from "@/components/auth/PasswordConfirmStep";
import { QrCode } from "@/components/auth/QrCode";
import { RecoveryCodesStep } from "@/components/auth/RecoveryCodesStep";
import { RecoveryRedeemStep } from "@/components/auth/RecoveryRedeemStep";
import { LoginScreen } from "@/components/login/LoginScreen";
import { useSignInFlow } from "@/containers/useSignInFlow";
import { useRedirectWhenSignedIn } from "@/hooks/useRedirectWhenSignedIn";
import { safeReturnPath } from "@/lib/returnPath";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

interface OidcConfiguration {
  enabled?: boolean;
  displayName?: string;
  providers?: { displayName?: unknown; loginUrl?: unknown }[];
}

interface ExternalProvider {
  displayName: string;
  loginUrl: string;
}

const ORIGINAL_LOGIN = "/api/auth/oidc/login";

/**
 * The identity providers the instance offers, none when sign-in is by
 * password only. A server from before several providers names one, which
 * signs in at the original address. Only addresses of this server's own
 * sign-in routes are followed.
 */
async function fetchExternalProviders(signal: AbortSignal): Promise<ExternalProvider[]> {
  const response = await fetch("/api/auth/oidc", { credentials: "include", signal });
  if (!response.ok) return [];
  const configuration = (await response.json()) as OidcConfiguration;
  if (!configuration.enabled) return [];
  const listed = (Array.isArray(configuration.providers) ? configuration.providers : []).flatMap((provider) =>
    typeof provider.loginUrl === "string" && /^\/api\/auth\/oidc\/([a-z0-9-]+\/)?login$/.test(provider.loginUrl)
      ? [
          {
            displayName: typeof provider.displayName === "string" ? provider.displayName.trim() : "",
            loginUrl: provider.loginUrl,
          },
        ]
      : [],
  );
  return listed.length > 0
    ? listed
    : [{ displayName: configuration.displayName?.trim() ?? "", loginUrl: ORIGINAL_LOGIN }];
}

export default function LoginPage() {
  const { phase, loginPending, loginError } = useSession();
  const { t } = useLanguage();
  const params = useSearchParams();
  const oidcError = params.get("oidc_error");
  const returnPath = safeReturnPath(params.get("returnUrl"));
  const [providers, setProviders] = useState<ExternalProvider[]>([]);
  const ports = usePorts();
  const [passkeyOffered, setPasskeyOffered] = useState(false);
  const confirm = params.get("confirm") === "1";
  // A recovery after the identity provider says which choice it left with.
  const [keepSignedIn, setKeepSignedIn] = useState(params.get("keep_signed_in") !== "0");
  const flow = useSignInFlow({
    recoveryRequired: params.get("security_recovery_required") === "1",
    confirm,
    keepSignedIn,
  });

  // A confirmation leaves only once the second step is done, not as soon as
  // the session is found to be signed in.
  useRedirectWhenSignedIn(confirm && flow.step.kind !== "done" ? "loading" : phase, returnPath);

  useEffect(() => {
    const controller = new AbortController();
    // The password form still works when the provider cannot be reached.
    fetchExternalProviders(controller.signal).then(setProviders, () => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!flow.passkeysSupported) return;
    let active = true;
    // Offered only when the server can check passkeys; the password form stays either way.
    ports.session.passkeySignInAvailable().then(
      (available) => active && setPasskeyOffered(available),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [flow.passkeysSupported, ports]);

  const externalError =
    oidcError === "not_linked"
      ? t("auth.login.oidcNotLinked")
      : oidcError === "failed"
        ? t("auth.login.oidcFailed")
        : null;

  const { step } = flow;
  if (step.kind === "challenge") {
    return (
      <MfaChallengeStep
        challenge={step.challenge}
        t={t}
        pending={flow.pending}
        error={flow.error}
        onVerify={flow.verify}
        onUseTrustedDevice={flow.continueOnTrustedDevice}
        onSendEmailCode={flow.sendEmailCode}
        onCancel={flow.cancel}
        // A trusted device cannot stand in for a fresh second step.
        offerTrust={step.challenge.purpose !== "reverify"}
        passkeysSupported={flow.passkeysSupported}
        onUsePasskey={flow.answerWithPasskey}
      />
    );
  }
  if (step.kind === "confirm-password") {
    return (
      <PasswordConfirmStep
        t={t}
        pending={flow.pending}
        error={flow.error}
        onSubmit={flow.confirmPassword}
        onBack={flow.cancel}
      />
    );
  }
  if (step.kind === "enroll") {
    return (
      <MfaEnrollStep
        challenge={step.challenge}
        t={t}
        mode={step.mode}
        enrollment={step.enrollment}
        emailRetryAfter={flow.enrollEmailWait}
        pending={flow.pending}
        error={flow.error}
        qr={
          step.enrollment?.otpAuthUri === undefined ? undefined : (
            <QrCode value={step.enrollment.otpAuthUri} label={t("auth.enroll.qrLabel")} />
          )
        }
        onModeChange={flow.setEnrollMode}
        onSendEmailCode={flow.sendEnrollEmailCode}
        onConfirm={flow.confirmEnrollment}
        onCancel={flow.cancel}
        passkeysSupported={flow.passkeysSupported}
        onCreatePasskey={flow.createPasskey}
      />
    );
  }
  if (step.kind === "codes") {
    return (
      <RecoveryCodesStep codes={step.codes} username={step.username} t={t} onDone={flow.finishCodes} />
    );
  }
  if (step.kind === "redeem") {
    return (
      <RecoveryRedeemStep
        t={t}
        pending={flow.pending}
        error={flow.error}
        onSubmit={flow.redeem}
        onBack={flow.cancel}
      />
    );
  }

  return (
    <LoginScreen
      t={t}
      // A login that needs nothing more re-runs the session bootstrap, and the
      // redirect hook navigates once it reports ready. Any further step stays
      // on this page.
      onSubmit={(username, password) => void flow.submitPassword(username, password, keepSignedIn)}
      keepSignedIn={{ checked: keepSignedIn, onChange: setKeepSignedIn }}
      passkeyLogin={
        passkeyOffered
          ? {
              label: t("auth.login.passkey"),
              onClick: () => flow.signInWithPasskey(keepSignedIn),
              pending: flow.pending,
            }
          : undefined
      }
      pending={loginPending}
      error={flow.error ?? loginError}
      checking={
        phase === "loading" ||
        step.kind === "resuming" ||
        step.kind === "done" ||
        (confirm && phase === "ready" && flow.error === null)
      }
      externalLogins={providers.map((provider) => ({
        href: `${provider.loginUrl}?returnUrl=${encodeURIComponent(returnPath ?? "/")}${
          keepSignedIn ? "" : "&keepSignedIn=false"
        }`,
        label: t("auth.login.oidc", {
          provider: provider.displayName || t("auth.login.oidcProvider"),
        }),
      }))}
      externalError={externalError}
    />
  );
}
