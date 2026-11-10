import {
  changedDeviceKinds,
  disconnectedDeviceFallbacks,
  type VoiceDeviceSelectionPatch,
  type VoiceDeviceSnapshot,
} from "./deviceMonitor";
import type { VoiceSettings } from "./settings";

/** One settings change to apply to a live call, with what has to be redone. */
export interface SettingsChange {
  settings: VoiceSettings;
  /** Reopen the microphone even if its settings are unchanged. */
  recaptureMic: boolean;
  /** Reopen the camera, if one is on, even if its settings are unchanged. */
  recaptureCamera: boolean;
  /** Move playback to the output device even if its settings are unchanged. */
  refreshPlayback: boolean;
}

/**
 * Applies settings changes to a live call one at a time.
 *
 * Settings change faster than a device opens: dragging a slider or plugging in
 * a headset can produce a burst. Changes that arrive while one is being
 * applied are folded into a single follow-up, which carries the newest
 * settings and every `recapture`/`refresh` request made meanwhile. A change
 * that is already out of date is therefore never applied.
 */
export class SettingsQueue {
  private waiting: SettingsChange | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly apply: (change: SettingsChange) => Promise<void>,
    private readonly stopped: () => boolean,
  ) {}

  /** What is queued behind the change being applied, if anything. */
  get pending(): SettingsChange | null {
    return this.waiting;
  }

  /** Resolves once this change, or a newer one that replaced it, has been applied. */
  push(change: SettingsChange): Promise<void> {
    if (this.stopped()) return Promise.resolve();
    const waiting = this.waiting;
    this.waiting = {
      settings: change.settings,
      recaptureMic: (waiting?.recaptureMic ?? false) || change.recaptureMic,
      recaptureCamera: (waiting?.recaptureCamera ?? false) || change.recaptureCamera,
      refreshPlayback: (waiting?.refreshPlayback ?? false) || change.refreshPlayback,
    };
    this.running ??= this.drain();
    return this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.waiting !== null && !this.stopped()) {
        const change = this.waiting;
        this.waiting = null;
        await this.apply(change);
      }
    } finally {
      this.running = null;
    }
  }
}

export interface DeviceChangePlan {
  /** The selections to remember because the chosen device is gone. */
  persist: VoiceDeviceSelectionPatch;
  change: SettingsChange;
}

/**
 * What a change in the plugged-in devices means for a running call.
 *
 * A concrete choice that vanished falls back to the system route, camera
 * included: the choice is forgotten even when no camera is on. Even without a
 * vanished choice, a changed device list can move what the system default
 * points at, and the default's id stays the same when its endpoint does, so
 * the microphone, the speakers and the camera have to be reopened on their own
 * account. Null when no audio device came or went and the camera, which is
 * left alone while it is chosen by id, is not affected.
 */
export function planDeviceChange(
  settings: VoiceSettings,
  previous: VoiceDeviceSnapshot,
  next: VoiceDeviceSnapshot,
): DeviceChangePlan | null {
  const changed = changedDeviceKinds(previous, next);
  const persist = disconnectedDeviceFallbacks(settings, previous, next);
  const inputFellBack = "inputDeviceId" in persist;
  const outputFellBack = "outputDeviceId" in persist;
  const cameraFellBack = "videoDeviceId" in persist;
  const recaptureCamera = cameraFellBack || (changed.videoInput && settings.videoDeviceId === null);
  if (!changed.audioInput && !changed.audioOutput && !recaptureCamera) return null;

  return {
    persist,
    change: {
      settings: { ...settings, ...persist },
      recaptureMic: inputFellBack || (changed.audioInput && settings.inputDeviceId === null),
      recaptureCamera,
      refreshPlayback: changed.audioOutput || outputFellBack,
    },
  };
}
