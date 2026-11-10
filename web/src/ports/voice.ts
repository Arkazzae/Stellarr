import type { JoinSoundServerGroup } from "@/lib/api/types";
import type { ActiveAutoGain, ActiveNoiseSuppression } from "@/lib/voice/micPipeline";
import type { VoiceSettings } from "@/lib/voice/settings";
import type { VoiceClient, VoiceState } from "@/lib/voice/types";

import type { Unsubscribe } from "./chat";

/**
 * The RTC port.
 *
 * `VoiceClient` already is the versioned contract from `docs/RTC_STANDARD.md`,
 * so it is the port; this only re-exports it so components import every port
 * from one place.
 */
export type VoicePort = VoiceClient;
export type { VoiceState, VoiceSettings };

/**
 * The words for each audio profile and noise mode.
 *
 * Part of the port's vocabulary rather than imported by the settings pane from
 * `lib/voice`, which components may not reach: a new profile has to arrive with
 * its own label or the pane cannot render it.
 */
export {
  INPUT_GAIN_MAX_DB,
  INPUT_GAIN_MIN_DB,
  INPUT_GAIN_STEP_DB,
  NOISE_MODE_HINT,
  NOISE_MODE_LABEL,
  OPUS_PROFILE_HINT,
  OPUS_PROFILE_LABEL,
  PLAYBACK_EQ_MAX_DB,
  PLAYBACK_EQ_MIN_DB,
  PLAYBACK_EQ_STEP_DB,
  PLAYBACK_TUNING_PRESETS,
} from "@/lib/voice/settings";
export type {
  NoiseSuppressionMode,
  OpusProfileId,
  PlaybackProfileId,
  PlaybackTuning,
} from "@/lib/voice/settings";
export { CAMERA_PROFILES } from "@/lib/voice/camera";
export type { CameraQualityId } from "@/lib/voice/camera";
/** The same for the screen: the control bar offers these while a share is set up. */
export {
  SCREEN_SHARE_PROFILES,
  SCREEN_SHARE_QUALITY_HINT,
  SCREEN_SHARE_QUALITY_LABEL,
} from "@/lib/voice/screenShare";
export type { ScreenShareQualityId } from "@/lib/voice/screenShare";
/** What the microphone is really doing, as opposed to what was requested. */
export type { ActiveAutoGain, ActiveNoiseSuppression } from "@/lib/voice/micPipeline";

/** Applies to a live call without dropping it. */
export interface VoiceSettingsPort {
  getSnapshot(): VoiceSettings;
  subscribe(listener: () => void): Unsubscribe;
  update(patch: Partial<VoiceSettings>): void;
  /**
   * Restores every default at once. The defaults are the store's to know; a
   * caller that spelled them out would be a second copy to keep in step.
   */
  reset(): void;
}

/** One microphone capture owned by a composer voice-message recorder. */
export interface VoiceMessageCapture {
  stream: MediaStream;
  /** The physical input track; the processed stream may outlive an unplug. */
  inputTrack: MediaStreamTrack;
  dispose(): void;
}

/** A capture failure with a Polish, user-facing message chosen by the container. */
export class VoiceMessageCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceMessageCaptureError";
  }
}

export type OpenVoiceMessageCapture = () => Promise<VoiceMessageCapture>;

/**
 * One microphone the settings pane can offer.
 *
 * Not `MediaDeviceInfo`: before permission is granted the browser returns
 * entries with empty labels, and a list of blanks is worse than none. The
 * container resolves each to something printable; `MicTest.labelsKnown` says
 * whether the labels are real.
 */
export interface InputDevice {
  deviceId: string;
  label: string;
}

/** A named playback or camera device offered by the browser. */
export interface MediaDeviceChoice {
  deviceId: string;
  label: string;
}

/**
 * Listening to your own microphone outside a call.
 *
 * The pane cannot open a device itself, so it is handed the readings and the
 * two buttons. `level` and `speaking` come from the detector the call uses, so
 * the sensitivity dial is calibrated against what it actually drives.
 */
export interface MicTest {
  devices: readonly InputDevice[];
  /** False until permission has been granted at least once. */
  labelsKnown: boolean;
  running: boolean;
  /** The mic is opening: between the click and the first frame. */
  starting: boolean;
  /** 0..1, smoothed and quantised by the detector. */
  level: number;
  /** The loudest recent level, held so a single syllable stays visible. */
  peak: number;
  /** What the call would decide right now: speech, or the room. */
  speaking: boolean;
  /** A whole sentence in the person's language, already worded by `MicCaptureError`. */
  error: string | null;
  /**
   * What is actually cleaning the microphone, which is not always what was
   * requested: RNNoise can fail to attach, and the pipeline then tries the
   * browser's own suppressor. Lets the UI stop claiming one that is not
   * running. `null` while nothing is open.
   */
  activeNoiseSuppression: ActiveNoiseSuppression | null;
  /**
   * Whether the input gate is really in the capture graph. `null` while
   * nothing is open; `false` with the gate switched on means this browser has
   * no AudioWorklet and the microphone goes out ungated.
   */
  gateActive: boolean | null;
  /** Which automatic volume is running: ours, the browser's or none. */
  autoGain: ActiveAutoGain | null;
  /**
   * The device the microphone actually opened on. Worth showing for
   * "System default", which names a rule rather than a microphone.
   */
  activeDeviceLabel: string | null;
  start: () => void;
  stop: () => void;
}

/** A short local sound routed through the selected call output. */
export interface OutputTest {
  devices: readonly MediaDeviceChoice[];
  labelsKnown: boolean;
  /** Whether this browser can route media to a chosen speaker. */
  deviceSelectionSupported: boolean;
  playing: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Choosing the clip a voice room hears when you walk in.
 *
 * A catalogue and one selection, both already resolved: every sound was
 * approved for some server's soundboard, and the choice belongs to the
 * account. The pane picks; it does not fetch. Sounds come cut to
 * `maxSeconds`, so the preview is the truth.
 */
export interface JoinSoundPicker {
  servers: readonly JoinSoundServerGroup[];
  loading: boolean;
  /** The catalogue could not be read. The stored choice still stands. */
  failed: boolean;
  /** What the account has chosen; null means the shared arrival chime. */
  selectedId: string | null;
  /**
   * Whether that choice is still in the catalogue. False after leaving the
   * server the sound came from: the setting survives, the sound does not.
   */
  selectionAvailable: boolean;
  /** Seconds of the clip a room ever hears. */
  maxSeconds: number;
  select: (soundId: string | null) => void;
  /** Plays the selected window here, for the person choosing it. */
  preview: () => void;
  reload: () => void;
}

/** Local-only camera preview used by the device settings pane. */
export interface CameraTest {
  devices: readonly MediaDeviceChoice[];
  labelsKnown: boolean;
  running: boolean;
  starting: boolean;
  stream: MediaStream | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}
