"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LoginScreen } from "@/components/login/LoginScreen";
import { useRedirectWhenSignedIn } from "@/hooks/useRedirectWhenSignedIn";
import { useLanguage, useSession } from "@/state/hooks";

interface OidcConfiguration {
  enabled?: boolean;
  displayName?: string;
}

/** The external identity provider the instance offers, or null when sign-in is by password only. */
async function fetchExternalProvider(signal: AbortSignal): Promise<{ displayName: string } | null> {
  const response = await fetch("/api/auth/oidc", { credentials: "include", signal });
  if (!response.ok) return null;
  const configuration = (await response.json()) as OidcConfiguration;
  return configuration.enabled ? { displayName: configuration.displayName?.trim() ?? "" } : null;
}

export default function LoginPage() {
  const { phase, login, loginPending, loginError } = useSession();
  const { t } = useLanguage();
  const oidcError = useSearchParams().get("oidc_error");
  const [provider, setProvider] = useState<{ displayName: string } | null>(null);

  useRedirectWhenSignedIn(phase);

  useEffect(() => {
    const controller = new AbortController();
    // The password form still works when the provider cannot be reached.
    fetchExternalProvider(controller.signal).then(setProvider, () => undefined);
    return () => controller.abort();
  }, []);

  const externalError =
    oidcError === "not_linked"
      ? t("auth.login.oidcNotLinked")
      : oidcError === "failed"
        ? t("auth.login.oidcFailed")
        : null;

  return (
    <LoginScreen
      t={t}
      // A successful login re-runs the session bootstrap, and the redirect hook
      // navigates once it reports ready.
      onSubmit={(username, password) => void login(username, password)}
      pending={loginPending}
      error={loginError}
      checking={phase === "loading"}
      externalLogin={
        provider === null
          ? undefined
          : {
              href: "/api/auth/oidc/login?returnUrl=%2F",
              label: t("auth.login.oidc", {
                provider: provider.displayName || t("auth.login.oidcProvider"),
              }),
            }
      }
      externalError={externalError}
    />
  );
}
