"use client";

import { useState } from "react";

import { Button } from "@stellarr/ui";
import { useLanguage } from "@/state/hooks";

/**
 * The way out of a pane that has been taken apart.
 *
 * Two clicks rather than a dialog: this resets the settings of one device and
 * nothing anyone else can see, which is too small a consequence for a modal on
 * top of a modal and too large a one for a single stray click.
 */
export function VoiceResetRow({ onReset }: { onReset: () => void }) {
  const { t } = useLanguage();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="set-row danger mic-reset">
      <span className="set-lab">
        <b>{t("voice.resetSettings")}</b>
        <span>{t("voice.resetSettingsDetail")}</span>
      </span>
      {confirming ? (
        <>
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)}>
            Anuluj
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => {
              setConfirming(false);
              onReset();
            }}
          >
            {t("voice.resetConfirm")}
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          {t("common.reset")}
        </Button>
      )}
    </div>
  );
}
