"use client";

import { ForgotPasswordScreen } from "@/components/auth/ForgotPasswordScreen";
import { useLanguage, usePorts } from "@/state/hooks";

export default function ForgotPasswordPage() {
  const ports = usePorts();
  const { t } = useLanguage();

  return (
    <ForgotPasswordScreen
      t={t}
      onSubmit={(email) => ports.session.requestPasswordReset(email)}
    />
  );
}
