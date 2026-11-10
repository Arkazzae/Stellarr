import { profileFor, usesWorkletSuppression } from "./audioProfiles";
import { browserFallback } from "./browserProcessing";
import { buildCaptureGraph, type GraphDeps } from "./captureGraph";
import { browserGetUserMedia, openMicrophone, type GetUserMedia } from "./micAcquire";
import { MicCaptureError, type MicCapture } from "./micCapture";
import { wantsCaptureGraph, type VoiceSettings } from "./settings";

/**
 * Capture and processing for the outgoing microphone.
 *
 * This is the module the rest of the app imports. The device handling, the
 * browser fallbacks and the Web Audio graph live in sibling files and are
 * re-exported here, so a caller needs one path whatever it wants.
 */
export { MicCaptureError } from "./micCapture";
export type {
  ActiveAutoGain,
  ActiveNoiseSuppression,
  DetectorStages,
  MicCapture,
  MicFailureKind,
} from "./micCapture";
export { restoreBrowserNoise, restoreBrowserProcessing } from "./browserProcessing";
export {
  hasDeviceLabels,
  listInputDevices,
  listOutputDevices,
  listVideoDevices,
} from "./micDevices";

export interface CaptureDeps extends GraphDeps {
  getUserMedia?: GetUserMedia;
}

/**
 * Open the microphone and build the outgoing track for these settings.
 *
 * Throws `MicCaptureError` so the caller can tell "blocked" from "no device"
 * and say something useful in Polish.
 */
export async function captureMicrophone(
  settings: VoiceSettings,
  deps: CaptureDeps = {},
): Promise<MicCapture> {
  const getUserMedia = deps.getUserMedia ?? browserGetUserMedia();
  if (!getUserMedia) {
    throw new MicCaptureError(
      "unsupported",
      "Ta przeglądarka nie może nagrywać dźwięku. Rozmowa głosowa wymaga połączenia HTTPS.",
    );
  }

  const { stream: raw, track: rawTrack } = await openMicrophone(settings, getUserMedia);
  const { contentHint } = profileFor(settings);
  rawTrack.contentHint = contentHint;

  const graph = wantsCaptureGraph(settings) ? await buildCaptureGraph(raw, settings, deps) : null;
  if (graph) graph.track.contentHint = contentHint;

  // The device was opened with the browser's suppressor and AGC off to make
  // room for ours. Whichever of ours is not running gets the browser's put back,
  // and what is reported is what the device confirms.
  const fallback = await browserFallback(rawTrack, settings.noiseSuppression, {
    noise: usesWorkletSuppression(settings.noiseSuppression) && !graph?.suppressor,
    autoGain: settings.autoGainControl && !graph?.levelling,
  });

  let disposed = false;
  return {
    track: graph?.track ?? rawTrack,
    stream: graph?.stream ?? raw,
    monitorStream: graph?.monitorStream ?? raw,
    rawTrack,
    processed: graph !== null,
    noiseSuppression: graph?.suppressor ?? fallback.noiseSuppression,
    gateActive: graph?.gateActive ?? false,
    autoGain: graph?.levelling ? "worklet" : fallback.autoGain,
    setSensitivity: (sensitivity) => graph?.setSensitivity(sensitivity),
    setInputGain: (db) => graph?.setInputGain(db),
    fadeIn: () => graph?.fadeIn(),
    resume: async () => (graph ? graph.resume() : true),
    dispose() {
      if (disposed) return;
      disposed = true;
      graph?.dispose();
      for (const track of raw.getTracks()) track.stop();
    },
  };
}
