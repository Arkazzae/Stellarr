"use client";

import { useRouter } from "next/navigation";

import { RegisterScreen } from "@/components/auth/RegisterScreen";
import { useRedirectWhenSignedIn } from "@/hooks/useRedirectWhenSignedIn";
import { pendingInvite } from "@/lib/invites";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

export default function RegistrationPage() {
  const ports = usePorts();
  const router = useRouter();
  const { phase, reload } = useSession();
  const { t } = useLanguage();

  useRedirectWhenSignedIn(phase);

  return (
    <RegisterScreen
      t={t}
      onSubmit={async (input) => {
        try {
          const inviteCode = pendingInvite();
          const result = await ports.session.register({
            ...input,
            ...(inviteCode === null ? {} : { inviteCode }),
          });
          // When this server requires a second step, the account exists but
          // has no session yet. The sign-in page resumes the setup from the
          // challenge the server keeps for this browser.
          if (result.kind === "signed-in") reload();
          else router.replace("/login");
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}
