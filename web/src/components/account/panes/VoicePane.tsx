"use client";

import type { CameraTest, MicTest, OutputTest, VoiceSettings } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { VoiceCameraCheck } from "./VoiceCameraSection";
import { MicrophoneCheck, VoiceMicrophoneSection } from "./VoiceMicrophoneSection";
import { SpeakerCheck, VoicePlaybackSection } from "./VoicePlaybackSection";
import { VoiceProcessingSection } from "./VoiceProcessingSection";
import { VoiceAudioQualityRow } from "./VoiceQualitySections";
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
 * Voice and video: the person's settings, not the server's.
 *
 * Two groups and a check. "Your voice" is the microphone, what is done to the
 * voice and what it costs on the connection; "what you hear" is the output,
 * its volume and how other voices are shaped. The checks (the microphone's
 * meter, a test clip and the camera's preview) sit beside them in one panel
 * that stays in view, so the meter answers while noise reduction or gain is
 * being changed rather than three screens away. The picture comes last: the
 * camera is what someone adds to a call that already works.
 *
 * Every setting is backed by the voice settings store, which the audio pipeline
 * reads live, so a change lands on a call in progress without dropping it. The
 * store keeps them in this browser and the account keeps a copy, all but the
 * chosen devices, which belong to this computer.
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
    <div className="vc-layout">
      <div className="vc-main">
        <section className="sc" aria-label={t("voice.yourVoice")}>
          <header className="sc-h">{t("voice.yourVoice")}</header>
          <div className="sc-b vc-group">
            <div className="frm">
              <VoiceMicrophoneSection
                settings={settings}
                onChange={onChange}
                onVadCommit={onVadCommit}
                mic={mic}
              />
              <VoiceProcessingSection settings={settings} onChange={onChange} mic={mic} />
              <VoiceAudioQualityRow settings={settings} onChange={onChange} />
            </div>
          </div>
        </section>

        <section className="sc" aria-label={t("voice.whatYouHear")}>
          <header className="sc-h">{t("voice.whatYouHear")}</header>
          <div className="sc-b vc-group">
            <div className="frm">
              <VoicePlaybackSection settings={settings} onChange={onChange} output={output} />
            </div>
          </div>
        </section>

        <VoiceResetRow onReset={onReset} />
      </div>

      <aside className="vc-check" aria-label={t("voice.checkDevices")}>
        <div className="vc-check-part">
          <h3>{t("voice.microphone")}</h3>
          <MicrophoneCheck mic={mic} />
        </div>
        <div className="vc-check-part">
          <h3>{t("voice.speakers")}</h3>
          <SpeakerCheck output={output} />
        </div>
        <div className="vc-check-part">
          <h3>{t("voice.camera")}</h3>
          <VoiceCameraCheck settings={settings} onChange={onChange} camera={camera} />
        </div>
      </aside>
    </div>
  );
}
