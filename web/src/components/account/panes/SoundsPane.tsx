"use client";

import { useId } from "react";

import type { JoinSoundPicker } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { JoinSoundSection } from "./JoinSoundSection";
import { FormRow, RangeField, SwitchRow, VoiceSection } from "./VoiceFields";

export interface SoundsPaneProps {
  /** Your own arrival, chosen from the soundboards of your servers. */
  joinSound?: JoinSoundPicker;
  /** Whether you hear others come and go; an account preference. */
  arrivalsAudible: boolean;
  onArrivalsAudibleChange: (audible: boolean) => void;
  /** How loud soundboard clips play here, 0 to 100. */
  soundboardVolume: number;
  onSoundboardVolumeChange: (volume: number) => void;
}

/**
 * The sounds a call makes besides the voices in it: the one others hear when
 * you walk in, the ones you hear when others do, and the soundboard.
 *
 * Its own pane rather than a corner of the profile or the notifications,
 * because these are all answers to "what will I hear", and more of them are
 * coming. The voices themselves, the devices and their volume stay in the
 * voice pane, and the message sound stays with the notifications, whose rule
 * for what deserves a sound it follows.
 */
export function SoundsPane({
  joinSound,
  arrivalsAudible,
  onArrivalsAudibleChange,
  soundboardVolume,
  onSoundboardVolumeChange,
}: SoundsPaneProps) {
  const { t } = useLanguage();
  const volumeId = useId();

  return (
    <>
      {joinSound ? <JoinSoundSection joinSound={joinSound} /> : null}

      <VoiceSection icon="headphones" title={t("sounds.inCall")}>
        <div className="frm">
          {/* One switch covers both halves of a comings-and-goings sound: the
              shared chime and the clip someone chose for their own arrival
              announce the same event, so "do I want to hear that" has one
              answer. */}
          <SwitchRow
            label={t("preference.joinLeaveSound")}
            detail={t("preference.joinLeaveSoundDetail")}
            checked={arrivalsAudible}
            onChange={onArrivalsAudibleChange}
          />
          <FormRow
            label={t("voice.soundboardVolume")}
            detail={t("sounds.soundboardVolumeDetail")}
            htmlFor={volumeId}
          >
            <RangeField
              id={volumeId}
              label={t("voice.soundboardVolume")}
              min={0}
              max={100}
              step={5}
              value={soundboardVolume}
              display={`${soundboardVolume}%`}
              onChange={onSoundboardVolumeChange}
            />
          </FormRow>
        </div>
      </VoiceSection>
    </>
  );
}
