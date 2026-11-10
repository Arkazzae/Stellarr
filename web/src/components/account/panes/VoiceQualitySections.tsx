"use client";

import {
  OPUS_PROFILE_HINT,
  OPUS_PROFILE_LABEL,
  SCREEN_SHARE_QUALITY_HINT,
  SCREEN_SHARE_QUALITY_LABEL,
  type OpusProfileId,
  type ScreenShareQualityId,
  type VoiceSettings,
} from "@/ports";
import { useLanguage } from "@/state/hooks";

import { VoiceSection } from "./VoiceFields";
import { Ladder, type Rung } from "./VoiceLadder";

interface QualitySectionProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
}

const OPUS_ORDER: readonly OpusProfileId[] = [
  "economy",
  "balanced",
  "clarity",
  "premium",
  "studio",
];

/** The bottom is what a poor link can carry, the top what a studio would keep. */
const OPUS_RUNGS: Record<OpusProfileId, Rung> = {
  economy: {
    icon: "wifi",
    label: OPUS_PROFILE_LABEL.economy,
    hint: OPUS_PROFILE_HINT.economy,
  },
  balanced: {
    icon: "signal",
    label: OPUS_PROFILE_LABEL.balanced,
    hint: OPUS_PROFILE_HINT.balanced,
  },
  clarity: {
    icon: "wave",
    label: OPUS_PROFILE_LABEL.clarity,
    hint: OPUS_PROFILE_HINT.clarity,
  },
  premium: {
    icon: "sparkle",
    label: OPUS_PROFILE_LABEL.premium,
    hint: OPUS_PROFILE_HINT.premium,
  },
  studio: {
    icon: "medal",
    label: OPUS_PROFILE_LABEL.studio,
    hint: OPUS_PROFILE_HINT.studio,
  },
};

const SCREEN_ORDER: readonly ScreenShareQualityId[] = [
  "economy",
  "balanced",
  "sharp",
  "ultra",
];

const SCREEN_RUNGS: Record<ScreenShareQualityId, Rung> = {
  economy: {
    icon: "wifi",
    label: SCREEN_SHARE_QUALITY_LABEL.economy,
    hint: SCREEN_SHARE_QUALITY_HINT.economy,
  },
  balanced: {
    icon: "signal",
    label: SCREEN_SHARE_QUALITY_LABEL.balanced,
    hint: SCREEN_SHARE_QUALITY_HINT.balanced,
  },
  sharp: {
    icon: "eye",
    label: SCREEN_SHARE_QUALITY_LABEL.sharp,
    hint: SCREEN_SHARE_QUALITY_HINT.sharp,
  },
  ultra: {
    icon: "sparkle",
    label: SCREEN_SHARE_QUALITY_LABEL.ultra,
    hint: SCREEN_SHARE_QUALITY_HINT.ultra,
  },
};

/**
 * The Opus bitrate profile.
 *
 * It belongs to the person rather than the channel for now: the server keeps no
 * channel-level audio settings, so this is the only choice that reaches the
 * encoder.
 */
export function VoiceAudioQualitySection({ settings, onChange }: QualitySectionProps) {
  const { t } = useLanguage();

  return (
    <VoiceSection icon="signal" title={t("voice.audioQuality")}>
      <p className="fld-note">{t("voice.audioQualityNote")}</p>
      <Ladder
        order={OPUS_ORDER}
        rungs={OPUS_RUNGS}
        value={settings.opusProfile}
        onChange={(opusProfile) => onChange({ opusProfile })}
        label={t("voice.audioProfile")}
      />
    </VoiceSection>
  );
}

/**
 * The other half of "Voice and video". The control bar offers the same choice, but
 * only mid-share, which is the worst moment to be reading about bitrates.
 */
export function VoiceScreenSharingSection({ settings, onChange }: QualitySectionProps) {
  const { t } = useLanguage();

  return (
    <VoiceSection icon="screencast" iconSize={19} title={t("voice.screenSharing")}>
      <p className="fld-note">{t("voice.screenQualityNote")}</p>
      <Ladder
        order={SCREEN_ORDER}
        rungs={SCREEN_RUNGS}
        value={settings.screenShareQuality}
        onChange={(screenShareQuality) => onChange({ screenShareQuality })}
        label={t("voice.screenQuality")}
      />
    </VoiceSection>
  );
}
