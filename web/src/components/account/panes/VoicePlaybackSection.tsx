"use client";

import { useId } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { ErrorNotice } from "@/components/primitives/ErrorNotice";
import { PLAYBACK_TUNING_PRESETS } from "@/ports";
import type { OutputTest, PlaybackProfileId, PlaybackTuning, VoiceSettings } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { DeviceSelect, FormRow, RangeField } from "./VoiceFields";
import { VoiceEqualiser } from "./VoiceEqualiser";
import { Ladder, type Rung } from "./VoiceLadder";

const PLAYBACK_ORDER: readonly PlaybackProfileId[] = [
  "off",
  "natural",
  "studio",
  "broadcast",
  "custom",
];

const PLAYBACK_RUNGS: Record<PlaybackProfileId, Rung> = {
  off: {
    label: "voice.playbackProfile.off",
    hint: "voice.playbackProfile.offHint",
  },
  natural: {
    label: "voice.playbackProfile.natural",
    hint: "voice.playbackProfile.naturalHint",
  },
  studio: {
    label: "voice.playbackProfile.studio",
    hint: "voice.playbackProfile.studioHint",
  },
  broadcast: {
    label: "voice.playbackProfile.broadcast",
    hint: "voice.playbackProfile.broadcastHint",
  },
  custom: {
    label: "voice.playbackProfile.custom",
    hint: "voice.playbackProfile.customHint",
  },
};

export interface VoicePlaybackSectionProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  output: OutputTest;
}

/**
 * Where calls are heard, how loud and how they sound: the rows of the "what
 * you hear" group. The clip to check it with is `SpeakerCheck`, in the check
 * panel beside them.
 */
export function VoicePlaybackSection({ settings, onChange, output }: VoicePlaybackSectionProps) {
  const { t } = useLanguage();
  const deviceId = useId();
  const volumeId = useId();

  // Picking a preset adopts its curve. Picking "custom" keeps the curve the
  // previous preset left, so the sliders open where the sound already was
  // instead of resetting.
  const selectProfile = (playbackProfile: PlaybackProfileId) =>
    onChange({
      playbackProfile,
      playbackTuning:
        playbackProfile === "custom"
          ? settings.playbackTuning
          : { ...PLAYBACK_TUNING_PRESETS[playbackProfile] },
    });

  // The bands only exist on screen under "custom", so moving one is always an
  // edit of the custom curve.
  const tune = (field: keyof PlaybackTuning, value: number) =>
    onChange({
      playbackProfile: "custom",
      playbackTuning: { ...settings.playbackTuning, [field]: value },
    });

  return (
    <>
      <FormRow
        label={t("voice.outputDevice")}
        detail={t("voice.outputDeviceDetail")}
        htmlFor={deviceId}
      >
        <DeviceSelect
          id={deviceId}
          label={t("voice.outputDevice")}
          devices={output.devices}
          value={settings.outputDeviceId}
          defaultLabel={t("voice.defaultSystem")}
          disabled={!output.deviceSelectionSupported}
          title={output.deviceSelectionSupported ? undefined : t("voice.systemOutputHint")}
          onChange={(outputDeviceId) => onChange({ outputDeviceId })}
        />
        {!output.deviceSelectionSupported ? (
          <p className="pf-count">{t("voice.systemOutputOnlyHint")}</p>
        ) : output.labelsKnown ? null : (
          <p className="pf-count">{t("voice.speakerNamesHint")}</p>
        )}
      </FormRow>

      <FormRow
        label={t("voice.playbackVolume")}
        detail={t("voice.playbackVolumeDetail")}
        htmlFor={volumeId}
      >
        <RangeField
          id={volumeId}
          label={t("voice.playbackVolume")}
          min={0}
          max={100}
          step={5}
          value={settings.outputVolume}
          display={`${settings.outputVolume}%`}
          onChange={(outputVolume) => onChange({ outputVolume })}
        />
      </FormRow>

      <FormRow label={t("voice.playbackProfile")} detail={t("voice.playbackProfileDetail")}>
        <Ladder
          order={PLAYBACK_ORDER}
          rungs={PLAYBACK_RUNGS}
          value={settings.playbackProfile}
          onChange={selectProfile}
          label={t("voice.playbackProfile")}
        />
      </FormRow>

      {settings.playbackProfile === "custom" ? (
        <VoiceEqualiser tuning={settings.playbackTuning} onChange={tune} />
      ) : null}
    </>
  );
}

/** A voice clip looped through the call sound and the chosen output. */
export function SpeakerCheck({ output }: { output: OutputTest }) {
  const { t } = useLanguage();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={output.playing ? "test-toggle on" : "test-toggle"}
        onClick={() => (output.playing ? output.stop() : output.start())}
      >
        <Icon name={output.playing ? "pause" : "play"} size={15} />
        {output.playing ? t("voice.stopSound") : t("voice.playSound")}
      </Button>
      <p className="pf-count output-status" role="status">
        {output.error !== null
          ? ""
          : output.playing
            ? t("voice.playingOnDevice")
            : t("voice.testReady")}
      </p>
      {output.error === null ? null : (
        <ErrorNotice
          compact
          title={t("voice.testSoundNotHear")}
          message={output.error}
          icon="speaker"
          actions={[{ label: t("common.tryAgain"), onClick: output.start }]}
        />
      )}
    </>
  );
}
