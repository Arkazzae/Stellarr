"use client";

import { useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/hooks";

/**
 * The foot of the voice pane: where its settings are kept, and the way out of
 * a pane that has been taken apart.
 *
 * Two clicks rather than a dialog: this resets the settings of one device and
 * nothing anyone else can see, which is too small a consequence for a modal on
 * top of a modal and too large a one for a single stray click. While it asks,
 * the note says what goes back.
 */
export function VoiceResetRow({ onReset }: { onReset: () => void }) {
  const { t } = useLanguage();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="vc-foot">
      <p>{confirming ? t("voice.resetSettingsDetail") : t("voice.settingsNote")}</p>
      {confirming ? (
        <span className="vc-foot-ask">
          <Button type="button" variant="quiet" size="sm" onClick={() => setConfirming(false)}>
            {t("common.cancel")}
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
        </span>
      ) : (
        <Button type="button" variant="quiet" size="sm" onClick={() => setConfirming(true)}>
          <Icon name="refresh" size={15} />
          {t("common.resetDefaults")}
        </Button>
      )}
    </div>
  );
}
