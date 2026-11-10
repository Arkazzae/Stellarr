"use client";

import { RegisterScreen } from "@/components/auth/RegisterScreen";
import { useRedirectWhenSignedIn } from "@/hooks/useRedirectWhenSignedIn";
import { pendingInvite } from "@/lib/invites";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

export default function RegistrationPage() {
  const ports = usePorts();
  const { phase, reload } = useSession();
  const { t } = useLanguage();

  useRedirectWhenSignedIn(phase);

  return (
    <RegisterScreen
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
