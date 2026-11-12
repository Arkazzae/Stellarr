"use client";

import { ResetPasswordScreen } from "@/components/auth/ResetPasswordScreen";
import { useLanguage, usePorts } from "@/state/hooks";

export function ResetPasswordClient({ token }: { token: string }) {
  const ports = usePorts();
  const { t } = useLanguage();

  return (
    <ResetPasswordScreen
      token={token}
      t={t}
      onSubmit={(value, password) => ports.session.resetPassword(value, password)}
    />
  );
}
