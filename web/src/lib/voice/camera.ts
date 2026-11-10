import type { VoiceSettings } from "./settings";

export type CameraQualityId = "economy" | "balanced" | "sharp";

export interface CameraProfile {
  width: number;
  height: number;
  maxFramerate: number;
  maxBitrate: number;
}

/** Capture and sender limits behind the camera quality choice. */
export const CAMERA_PROFILES: Readonly<Record<CameraQualityId, CameraProfile>> =
  Object.freeze({
    economy: { width: 854, height: 480, maxFramerate: 24, maxBitrate: 700_000 },
    balanced: { width: 1280, height: 720, maxFramerate: 30, maxBitrate: 1_500_000 },
    sharp: { width: 1920, height: 1080, maxFramerate: 30, maxBitrate: 3_000_000 },
  });

export const DEFAULT_CAMERA_QUALITY: CameraQualityId = "balanced";

/** The default profile's limits, for callers that do not take a quality. */
export const CAMERA_MAX_BITRATE = CAMERA_PROFILES[DEFAULT_CAMERA_QUALITY].maxBitrate;
export const CAMERA_MAX_FRAMERATE = CAMERA_PROFILES[DEFAULT_CAMERA_QUALITY].maxFramerate;

export type CameraCaptureErrorKind = "denied" | "unavailable" | "unsupported";

export class CameraCaptureError extends Error {
  constructor(
    readonly kind: CameraCaptureErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CameraCaptureError";
  }
}

export interface CameraCapture {
  stream: MediaStream;
  video: MediaStreamTrack;
  dispose(): void;
}

type CameraSettings = Pick<VoiceSettings, "videoDeviceId" | "cameraQuality">;
type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** Camera constraints for the selected profile, always without hidden audio. */
export function cameraConstraints(settings: CameraSettings): MediaStreamConstraints {
  const { width, height, maxFramerate } = CAMERA_PROFILES[settings.cameraQuality];
  return {
    audio: false,
    video: {
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: maxFramerate, max: maxFramerate },
      ...(settings.videoDeviceId === null
        ? { facingMode: "user" }
        : { deviceId: { exact: settings.videoDeviceId } }),
    },
  };
}

function browserGetUserMedia(): GetUserMedia | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

/** Whether this browser can open a camera at all, joined to a call or not. */
export function cameraIsSupported(): boolean {
  return browserGetUserMedia() !== null;
}

/** Opens one video-only stream and normalises browser errors for the UI. */
export async function captureCamera(
  settings: CameraSettings,
  getUserMedia: GetUserMedia | null = browserGetUserMedia(),
): Promise<CameraCapture> {
  if (!getUserMedia) {
    throw new CameraCaptureError(
      "unsupported",
      "Ta przeglądarka nie obsługuje kamery w rozmowie.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await getUserMedia(cameraConstraints(settings));
  } catch (cause) {
    throw classifyCameraError(cause);
  }

  const video = stream.getVideoTracks()[0];
  if (!video) {
    stopTracks(stream);
    throw new CameraCaptureError(
      "unavailable",
      "Kamera nie przekazała obrazu. Wybierz inne urządzenie i spróbuj ponownie.",
    );
  }

  video.contentHint = "motion";
  return { stream, video, dispose: () => stopTracks(stream) };
}

export function cameraEncoding(
  quality: CameraQualityId = DEFAULT_CAMERA_QUALITY,
): RTCRtpEncodingParameters {
  const { maxBitrate, maxFramerate } = CAMERA_PROFILES[quality];
  return { maxBitrate, maxFramerate, networkPriority: "medium", priority: "medium" };
}

function classifyCameraError(cause: unknown): CameraCaptureError {
  const name = cause instanceof DOMException ? cause.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new CameraCaptureError(
        "denied",
        "Dostęp do kamery został zablokowany. Zezwól na niego w ustawieniach przeglądarki i spróbuj ponownie.",
      );
    case "NotFoundError":
    case "OverconstrainedError":
    case "NotReadableError":
    case "AbortError":
      return new CameraCaptureError(
        "unavailable",
        "Wybrana kamera jest niedostępna albo używa jej inna aplikacja.",
      );
    case "NotSupportedError":
      return new CameraCaptureError(
        "unsupported",
        "Ta przeglądarka nie obsługuje kamery w rozmowie.",
      );
    default:
      return new CameraCaptureError(
        "unavailable",
        "Nie udało się włączyć kamery. Sprawdź urządzenie i spróbuj ponownie.",
      );
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
