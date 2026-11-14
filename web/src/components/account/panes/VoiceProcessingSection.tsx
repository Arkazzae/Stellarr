"use client";

import type { MessageKey } from "@/i18n";
import {
  NOISE_MODE_HINT,
  NOISE_MODE_LABEL,
  type ActiveNoiseSuppression,
  type MicTest,
  type NoiseSuppressionMode,
  type VoiceSettings,
} from "@/ports";
import { useLanguage } from "@/state/hooks";

import { SwitchRow } from "./VoiceFields";
import { Ladder, type Rung } from "./VoiceLadder";

const NOISE_ORDER: readonly NoiseSuppressionMode[] = [
  "browser",
  "rnnoise",
  "gtcrn",
  "speex",
  "off",
];

/** The artwork is shared with the noise button in the voice dock. */
const NOISE_RUNGS: Record<NoiseSuppressionMode, Rung> = {
  browser: {
    label: NOISE_MODE_LABEL.browser,
    hint: NOISE_MODE_HINT.browser,
  },
  rnnoise: {
    label: NOISE_MODE_LABEL.rnnoise,
    hint: NOISE_MODE_HINT.rnnoise,
  },
  gtcrn: {
    label: NOISE_MODE_LABEL.gtcrn,
    hint: NOISE_MODE_HINT.gtcrn,
  },
  speex: {
    label: NOISE_MODE_LABEL.speex,
    hint: NOISE_MODE_HINT.speex,
  },
  off: {
    label: NOISE_MODE_LABEL.off,
    hint: NOISE_MODE_HINT.off,
  },
};

/**
 * What each suppressor is called once it is the one actually running.
 *
 * Separate from the rung labels, which name the choice: "Off" is a
 * sensible thing to pick and a strange thing to be told is happening.
 */
const ACTIVE_NOISE_LABEL: Record<ActiveNoiseSuppression, MessageKey> = {
  rnnoise: "voice.noise.rnnoise",
  gtcrn: "voice.noise.gtcrn",
  speex: "voice.noise.speex",
  browser: "voice.noise.activeBrowser",
  none: "voice.noise.activeNone",
};

/** Which suppressor each choice is supposed to produce. */
const EXPECTED_NOISE: Record<NoiseSuppressionMode, ActiveNoiseSuppression> = {
  rnnoise: "rnnoise",
  gtcrn: "gtcrn",
  speex: "speex",
  browser: "browser",
  off: "none",
};

export interface VoiceProcessingSectionProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  mic: MicTest;
}

/**
 * Noise suppression, echo cancellation and automatic volume: rows of the "your
 * voice" group, after the microphone's own.
 */
export function VoiceProcessingSection({
  settings,
  onChange,
  mic,
}: VoiceProcessingSectionProps) {
  const { t } = useLanguage();
  const active = mic.activeNoiseSuppression;

  return (
    <>
      <div className="frm-row">
        <span className="frm-lab">{t("voice.noiseReduction")}</span>
        <div className="frm-ctl">
          <Ladder
            order={NOISE_ORDER}
            rungs={NOISE_RUNGS}
            value={settings.noiseSuppression}
            onChange={(noiseSuppression) => onChange({ noiseSuppression })}
            label={t("voice.noiseReduction")}
          />
        </div>
      </div>

      {/* What was picked is a request. RNNoise can fail to load, and the
          pipeline then puts the browser's own suppressor back, or fails at
          that too. It reports which one is really running so that this line can
          exist: a panel that shows "RNNoise" over an unsuppressed microphone is
          worse than one that shows nothing. Only worth saying while a capture
          is open and only when it disagrees with the choice above. */}
      {active !== null && active !== EXPECTED_NOISE[settings.noiseSuppression] ? (
        <p className="acc-answer bad mic-truth" role="status">
          {t("voice.selectedNoiseMismatch", {
            selected: t(NOISE_RUNGS[settings.noiseSuppression].label),
            active: t(ACTIVE_NOISE_LABEL[active]),
          })}
        </p>
      ) : null}

      <SwitchRow
        label={t("voice.echoCancellation")}
        detail={t("voice.echoCancellationDetail")}
        checked={settings.echoCancellation}
        onChange={(echoCancellation) => onChange({ echoCancellation })}
      />
      <SwitchRow
        label={t("voice.autoGain")}
        detail={t("voice.autoGainDetail")}
        checked={settings.autoGainControl}
        onChange={(autoGainControl) => onChange({ autoGainControl })}
      />
      {/* Ours learns only from speech while the browser's turns the room up
          too, and a switch that is on while neither runs is a lie. */}
      {settings.autoGainControl && mic.autoGain === "browser" ? (
        <p className="acc-answer mic-truth" role="status">
          {t("voice.autoGainBrowser")}
        </p>
      ) : settings.autoGainControl && mic.autoGain === "none" ? (
        <p className="acc-answer bad mic-truth" role="status">
          {t("voice.autoGainUnavailable")}
        </p>
      ) : null}

      {/* Reopening the device is what these choices cost, and the test is what
          holds it open, so say so where it happens. */}
      {mic.running ? <p className="fld-note mic-recapture">{t("voice.micRecapture")}</p> : null}
    </>
  );
}
