"use client";

import { useId, type CSSProperties } from "react";

import {
  OPUS_PROFILE_HINT,
  OPUS_PROFILE_KBPS,
  OPUS_PROFILE_LABEL,
  type OpusProfileId,
  type VoiceSettings,
} from "@/ports";
import { useLanguage } from "@/state/hooks";

import { FormRow, RangeField } from "./VoiceFields";

interface QualityRowProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
}

/** From what a poor link can carry to what a studio would keep. */
const OPUS_ORDER: readonly OpusProfileId[] = [
  "economy",
  "balanced",
  "clarity",
  "premium",
  "studio",
];

/**
 * The Opus bitrate profile, the last row of the "your voice" group: what the
 * voice costs on the connection.
 *
 * One slider with five stops rather than five cards: the choice is a degree,
 * and each stop names its bitrate under the track. It belongs to the person
 * rather than the channel for now: the server keeps no channel-level audio
 * settings, so this is the only choice that reaches the encoder.
 *
 * The screen-share quality is not here. It is chosen in the call's own bar,
 * while sharing, where its effect can be seen.
 */
export function VoiceAudioQualityRow({ settings, onChange }: QualityRowProps) {
  const { t } = useLanguage();
  const id = useId();
  const profile = settings.opusProfile;
  const name = t(OPUS_PROFILE_LABEL[profile]);

  return (
    <FormRow label={t("voice.audioQuality")} detail={t("voice.audioQualityNote")} htmlFor={id}>
      <RangeField
        id={id}
        min={0}
        max={OPUS_ORDER.length - 1}
        step={1}
        value={OPUS_ORDER.indexOf(profile)}
        display={name}
        valueText={`${name}, ${OPUS_PROFILE_KBPS[profile]} kb/s`}
        onChange={(index) => onChange({ opusProfile: OPUS_ORDER[index] ?? profile })}
      />
      <span
        className="vc-ticks"
        aria-hidden="true"
        style={{ "--stops": OPUS_ORDER.length - 1 } as CSSProperties}
      >
        {OPUS_ORDER.map((stop, index) => (
          <i key={stop} style={{ "--k": index } as CSSProperties}>
            {OPUS_PROFILE_KBPS[stop]}
          </i>
        ))}
      </span>
      <p className="ladder-note">{t(OPUS_PROFILE_HINT[profile])}</p>
    </FormRow>
  );
}
