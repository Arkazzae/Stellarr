import { microphoneConstraints } from "./audioProfiles";
import { MicCaptureError } from "./micCapture";
import type { VoiceSettings } from "./settings";

export type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export interface OpenedMicrophone {
  stream: MediaStream;
  track: MediaStreamTrack;
}

const NO_MICROPHONE = "Brak dostępnego mikrofonu. Podłącz go i dołącz ponownie.";

/** The browser's own `getUserMedia`, or null where there is none (insecure origin, old browser). */
export function browserGetUserMedia(): GetUserMedia | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

function failureFor(cause: unknown): MicCaptureError {
  const name = typeof cause === "object" && cause !== null && "name" in cause ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new MicCaptureError(
      "denied",
      "Dostęp do mikrofonu został zablokowany. Zezwól na niego w ustawieniach przeglądarki i dołącz ponownie.",
    );
  }
  if (name === "OverconstrainedError" || name === "NotFoundError") {
    return new MicCaptureError(
      "unavailable",
      "Wybrany mikrofon jest niedostępny. Wybierz inny i spróbuj ponownie.",
    );
  }
  return new MicCaptureError("unavailable", NO_MICROPHONE);
}

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Echo-cancellation modes beyond the boolean, strongest first. */
const ISOLATION_MODES = ["all", "remote-only"] as const;
type IsolationMode = (typeof ISOLATION_MODES)[number];

/** The spec's string modes are not in the DOM typings, which only know booleans. */
type IsolationCapabilities = { echoCancellation?: unknown[] };
type IsolationSettings = { echoCancellation?: unknown };

function advertisedIsolationModes(track: MediaStreamTrack): IsolationMode[] {
  try {
    const advertised = (track.getCapabilities?.() as IsolationCapabilities | undefined)
      ?.echoCancellation;
    return ISOLATION_MODES.filter((mode) => advertised?.includes(mode));
  } catch {
    return [];
  }
}

function appliedEchoCancellation(track: MediaStreamTrack): unknown {
  try {
    return (track.getSettings() as IsolationSettings).echoCancellation;
  } catch {
    // An exact constraint that resolved is authoritative on browsers that do
    // not report the selected mode in getSettings().
    return undefined;
  }
}

async function captureWithIsolation(
  mode: IsolationMode,
  constraints: MediaTrackConstraints,
  getUserMedia: GetUserMedia,
): Promise<MediaStream | null> {
  let stream: MediaStream;
  try {
    const isolating = { ...constraints, echoCancellation: { exact: mode } };
    stream = await getUserMedia({
      audio: isolating as unknown as MediaTrackConstraints,
      video: false,
    });
  } catch {
    return null;
  }
  const track = stream.getAudioTracks()[0];
  if (track) {
    const applied = appliedEchoCancellation(track);
    if (applied === undefined || applied === mode) return stream;
  }
  stopAll(stream);
  return null;
}

/**
 * Upgrade ordinary boolean echo cancellation to the strongest mode this browser
 * advertises.
 *
 * Chromium accepts the string modes at getUserMedia time but can reject the
 * same mode through applyConstraints on a live track. The first capture is
 * therefore kept until a replacement has actually been granted: failure falls
 * back to working boolean AEC rather than losing the microphone.
 */
async function recaptureWithVoiceIsolation(
  original: MediaStream,
  constraints: MediaTrackConstraints,
  getUserMedia: GetUserMedia,
): Promise<MediaStream> {
  const originalTrack = original.getAudioTracks()[0];
  if (!originalTrack) return original;

  for (const mode of advertisedIsolationModes(originalTrack)) {
    const isolated = await captureWithIsolation(mode, constraints, getUserMedia);
    if (isolated) {
      // A stream handed back unchanged is still the only live capture.
      if (isolated !== original) stopAll(original);
      return isolated;
    }
  }
  return original;
}

/**
 * Open the device for these settings.
 *
 * Throws `MicCaptureError`, so the caller can tell "blocked" from "no device"
 * and say something useful. A stream that arrives without an audio track is
 * stopped before the error is thrown.
 */
export async function openMicrophone(
  settings: VoiceSettings,
  getUserMedia: GetUserMedia,
): Promise<OpenedMicrophone> {
  const constraints = microphoneConstraints(settings);
  let stream: MediaStream;
  try {
    stream = await getUserMedia({ audio: constraints, video: false });
  } catch (cause) {
    throw failureFor(cause);
  }

  if (settings.echoCancellation) {
    stream = await recaptureWithVoiceIsolation(stream, constraints, getUserMedia);
  }

  const track = stream.getAudioTracks()[0];
  if (!track) {
    stopAll(stream);
    throw new MicCaptureError("unavailable", NO_MICROPHONE);
  }
  return { stream, track };
}
