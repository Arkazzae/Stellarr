"use client";

import { useEffect, useState } from "react";

import { AuthFrame, authStyles } from "@/components/auth/AuthFrame";
import { RegisterScreen } from "@/components/auth/RegisterScreen";
import { useRedirectWhenSignedIn } from "@/hooks/useRedirectWhenSignedIn";
import { pendingInvite } from "@/lib/invites";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

export default function RegistrationPage() {
  const ports = usePorts();
  const { phase, reload } = useSession();
  const { t } = useLanguage();

  const [setup, setSetup] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    ports.session.needsServerSetup().then((needed) => {
      if (active) setSetup(needed && pendingInvite() === null);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [ports, attempt]);

  useRedirectWhenSignedIn(phase);

  if (setup === null) return (
    <AuthFrame title={t("auth.register.title")} description={t("auth.setup.checking")}>
      {failed ? <>
        <p role="alert" className={authStyles.error}>{t("auth.setup.loadFailed")}</p>
        <button className={authStyles.submit} onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>
          {t("auth.setup.retry")}
        </button>
      </> : <p role="status" className={authStyles.checking}>{t("auth.setup.checking")}</p>}
    </AuthFrame>
  );

  return (
    <RegisterScreen
      needsServerSetup={setup}
      t={t}
      onSubmit={async (input) => {
        try {
          const inviteCode = pendingInvite();
          await ports.session.register({
            ...input,
            ...(inviteCode === null ? {} : { inviteCode }),
          });
          reload();
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}
