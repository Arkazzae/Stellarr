"use client";

import Link from "next/link";

import { AuthFrame, authStyles as styles } from "@/components/auth/AuthFrame";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/hooks";

export type LinkOutcome = "linked" | "taken" | "other" | "cancelled" | "failed";

const DESCRIPTION: Record<LinkOutcome, MessageKey> = {
  linked: "linkAccount.linked",
  taken: "linkAccount.taken",
  other: "linkAccount.other",
  cancelled: "linkAccount.cancelled",
  failed: "linkAccount.failed",
};

/** Where the identity provider sends the browser back after a link started in the settings. */
export function LinkAccountResult({ outcome }: { outcome: LinkOutcome }) {
  const { t } = useLanguage();
  return (
    <AuthFrame
      title={outcome === "linked" ? t("linkAccount.linkedTitle") : t("linkAccount.failedTitle")}
      description={t(DESCRIPTION[outcome])}
    >
      <Link className={styles.submit} href="/">
        {t("linkAccount.back")}
      </Link>
    </AuthFrame>
  );
}
