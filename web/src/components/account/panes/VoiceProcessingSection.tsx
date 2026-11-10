"use client";

import type { MessageKey } from "@/i18n";
import type {
  ActiveNoiseSuppression,
  MicTest,
  NoiseSuppressionMode,
  VoiceSettings,
} from "@/ports";
import { useLanguage } from "@/state/hooks";

import { SwitchRow, VoiceSection } from "./VoiceFields";
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
    icon: "noiseBrowser",
    label: "voice.noise.browser",
    hint: "voice.noise.browserHint",
  },
  rnnoise: {
    icon: "noiseRnnoise",
    label: "voice.noise.rnnoise",
    hint: "voice.noise.rnnoiseHint",
  },
  gtcrn: { icon: "noiseGtcrn", label: "voice.noise.gtcrn", hint: "voice.noise.gtcrnHint" },
  speex: { icon: "noiseSpeex", label: "voice.noise.speex", hint: "voice.noise.speexHint" },
  off: { icon: "noiseOff", label: "voice.noise.off", hint: "voice.noise.offHint" },
};

/**
 * What each suppressor is called once it is the one actually running.
 *
 * Separate from the rung labels, which name the choice: "Wyłączona" is a
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

/** Noise suppression, echo cancellation and automatic volume. */
export function VoiceProcessingSection({
  settings,
  onChange,
  mic,
}: VoiceProcessingSectionProps) {
  const { t } = useLanguage();
  const active = mic.activeNoiseSuppression;

  return (
    <VoiceSection icon="wave" title={t("voice.processing")}>
      <span className="fld-lab">{t("voice.noiseReduction")}</span>
      <Ladder
        order={NOISE_ORDER}
        rungs={NOISE_RUNGS}
        value={settings.noiseSuppression}
        onChange={(noiseSuppression) => onChange({ noiseSuppression })}
        label={t("voice.noiseReduction")}
        iconSize={24}
      />

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

      <div className="frm">
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
      </div>

      {/* Reopening the device is what these choices cost, and the test is what
          holds it open, so say so where it happens. */}
      {mic.running ? <p className="fld-note mic-recapture">{t("voice.micRecapture")}</p> : null}
    </VoiceSection>
  );
}
