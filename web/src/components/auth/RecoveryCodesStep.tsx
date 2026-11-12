"use client";

import { useState } from "react";

import { AuthFrame, authStyles as styles } from "@/components/auth/AuthFrame";
import type { Translator } from "@/i18n";

import steps from "./SignInSteps.module.css";

export interface RecoveryCodesStepProps {
  codes: readonly string[];
  username: string;
  t: Translator;
  onDone(): void;
}

/**
 * The recovery codes, shown the one time the server hands them out. Leaving
 * needs a tick that they were saved, because nothing brings them back.
 */
export function RecoveryCodesStep({ codes, username, t, onDone }: RecoveryCodesStepProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = [t("auth.codes.fileHeader", { username }), "", ...codes, ""].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // The list stays on screen to be written down.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `stellarr-recovery-codes-${username}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AuthFrame title={t("auth.codes.title")} description={t("auth.codes.description")}>
      <div className={styles.form}>
        <ul className={steps.codes} aria-label={t("auth.codes.title")}>
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className={steps.actions}>
          <button type="button" className={steps.copy} onClick={() => void copy()}>
            {copied ? t("auth.codes.copied") : t("auth.codes.copy")}
          </button>
          <button type="button" className={steps.copy} onClick={download}>
            {t("auth.codes.download")}
          </button>
        </div>
        <label className={steps.check}>
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>{t("auth.codes.saved")}</span>
        </label>
        <button type="button" className={styles.submit} disabled={!saved} onClick={onDone}>
          {t("auth.codes.continue")}
        </button>
      </div>
    </AuthFrame>
  );
}
