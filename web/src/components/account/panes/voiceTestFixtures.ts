import type { CameraTest, MicTest, OutputTest, VoiceSettings } from "@/ports";

/*
 * Test support for the voice pane and its sections. A literal rather than the
 * store's defaults: tests under components may only reach `@/ports`, and the
 * values the pane shows should be visible next to the assertions about them.
 */

export const voiceSettings: VoiceSettings = {
  version: 1,
  inputDeviceId: null,
  outputDeviceId: null,
  outputVolume: 100,
  soundboardVolume: 100,
  playbackProfile: "studio",
  playbackTuning: {
    warmthDb: 3.5,
    mudDb: -4.5,
    presenceDb: 5,
    airDb: 3,
    compression: 65,
  },
  videoDeviceId: null,
  cameraQuality: "balanced",
  opusProfile: "premium",
  screenShareQuality: "balanced",
  noiseSuppression: "browser",
  echoCancellation: true,
  autoGainControl: true,
  vadSensitivity: 60,
  inputGainDb: 0,
  inputGate: true,
};

/** A microphone that is present and idle. */
export const idleMic: MicTest = {
  devices: [{ deviceId: "mic-1", label: "Blue Yeti" }],
  labelsKnown: true,
  running: false,
  starting: false,
  level: 0,
  peak: 0,
  speaking: false,
  error: null,
  activeNoiseSuppression: null,
  gateActive: null,
  autoGain: null,
  activeDeviceLabel: null,
  start: () => undefined,
  stop: () => undefined,
};

export const idleOutput: OutputTest = {
  devices: [{ deviceId: "speaker-1", label: "Słuchawki USB" }],
  labelsKnown: true,
  deviceSelectionSupported: true,
  playing: false,
  error: null,
  start: () => undefined,
  stop: () => undefined,
};

export const idleCamera: CameraTest = {
  devices: [{ deviceId: "camera-1", label: "Kamera HD" }],
  labelsKnown: true,
  running: false,
  starting: false,
  stream: null,
  error: null,
  start: () => undefined,
  stop: () => undefined,
};
