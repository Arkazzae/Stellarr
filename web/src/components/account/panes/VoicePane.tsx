"use client";

import type { CameraTest, MicTest, OutputTest, VoiceSettings } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { VoiceCameraSection } from "./VoiceCameraSection";
import { VoiceMicrophoneSection } from "./VoiceMicrophoneSection";
import { VoicePlaybackSection } from "./VoicePlaybackSection";
import { VoiceProcessingSection } from "./VoiceProcessingSection";
import { VoiceAudioQualitySection, VoiceScreenSharingSection } from "./VoiceQualitySections";
import { VoiceResetRow } from "./VoiceResetRow";

export interface VoicePaneProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  /** Persists the already-applied speech sensitivity in the signed-in account. */
  onVadCommit: (value: number) => void;
  /** Back to the defaults, every field at once. */
  onReset: () => void;
  mic: MicTest;
  output: OutputTest;
  camera: CameraTest;
}

/**
 * Voice and video: the device's settings, not the server's.
 *
 * Ordered by what goes wrong. The microphone comes first, because a call on the
 * wrong one is not a quality problem but silence, then what is heard, then the
 * processing and codecs that matter to someone who can already be heard. The
 * picture follows the sound rather than interleaving with it: the camera and
 * the screen are what someone adds to a call that already works.
 *
 * Every setting is backed by the voice settings store, which persists to this
 * browser while the audio pipeline reads it live, so a change lands on a call
 * in progress without dropping it.
 */
export function VoicePane({
  settings,
  onChange,
  onVadCommit,
  onReset,
  mic,
  output,
  camera,
}: VoicePaneProps) {
  const { t } = useLanguage();

  return (
    <>
      <p className="set-note">{t("voice.settingsNote")}</p>
      <VoiceMicrophoneSection
        settings={settings}
        onChange={onChange}
        onVadCommit={onVadCommit}
        mic={mic}
      />
      <VoicePlaybackSection settings={settings} onChange={onChange} output={output} />
      <VoiceProcessingSection settings={settings} onChange={onChange} mic={mic} />
      <VoiceAudioQualitySection settings={settings} onChange={onChange} />
      <VoiceCameraSection settings={settings} onChange={onChange} camera={camera} />
      <VoiceScreenSharingSection settings={settings} onChange={onChange} />
      <VoiceResetRow onReset={onReset} />
    </>
  );
}
