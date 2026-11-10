"use client";

import type { OpusProfileId, ScreenShareQualityId, VoiceSettings } from "@/ports";
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
  economy: { icon: "wifi", label: "voice.profile.economy", hint: "voice.profile.economyHint" },
  balanced: {
    icon: "signal",
    label: "voice.profile.balanced",
    hint: "voice.profile.balancedHint",
  },
  clarity: { icon: "wave", label: "voice.profile.clarity", hint: "voice.profile.clarityHint" },
  premium: {
    icon: "sparkle",
    label: "voice.profile.premium",
    hint: "voice.profile.premiumHint",
  },
  studio: { icon: "medal", label: "voice.profile.studio", hint: "voice.profile.studioHint" },
};

const SCREEN_ORDER: readonly ScreenShareQualityId[] = [
  "economy",
  "balanced",
  "sharp",
  "ultra",
];

const SCREEN_RUNGS: Record<ScreenShareQualityId, Rung> = {
  economy: { icon: "wifi", label: "voice.screen.economy", hint: "voice.screen.economyHint" },
  balanced: {
    icon: "signal",
    label: "voice.screen.balanced",
    hint: "voice.screen.balancedHint",
  },
  sharp: { icon: "eye", label: "voice.screen.sharp", hint: "voice.screen.sharpHint" },
  ultra: { icon: "sparkle", label: "voice.screen.ultra", hint: "voice.screen.ultraHint" },
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
 * The other half of "Głos i wideo". The control bar offers the same choice, but
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
