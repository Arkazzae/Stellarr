/**
 * Screen capture.
 *
 * `getDisplayMedia` is gated on HTTPS and a user gesture, and the picker is
 * authoritative: the browser decides what is shared and whether audio comes
 * with it. Everything here is a preference the browser may ignore, and the
 * result is read back rather than assumed.
 */

export type ScreenShareQualityId = "economy" | "balanced" | "sharp" | "ultra";

export interface ScreenShareProfile {
  maxHeight: number;
  maxFramerate: number;
  maxBitrate: number;
  /** Temporal layers let congestion control drop frames without blurring text. */
  scalabilityMode: "L1T2" | "L1T3";
}

export type ScreenRtpEncodingParameters = RTCRtpEncodingParameters & {
  /** Supported by Chromium for VP9/AV1, absent from older TypeScript DOM libs. */
  scalabilityMode?: ScreenShareProfile["scalabilityMode"];
};

export const DEFAULT_SCREEN_SHARE_QUALITY: ScreenShareQualityId = "balanced";

function profile(
  maxHeight: number,
  maxFramerate: number,
  maxBitrate: number,
  scalabilityMode: ScreenShareProfile["scalabilityMode"],
): Readonly<ScreenShareProfile> {
  return Object.freeze({ maxHeight, maxFramerate, maxBitrate, scalabilityMode });
}

export const SCREEN_SHARE_PROFILES: Readonly<
  Record<ScreenShareQualityId, Readonly<ScreenShareProfile>>
> = Object.freeze({
  economy: profile(720, 15, 1_000_000, "L1T2"),
  balanced: profile(1080, 30, 2_500_000, "L1T2"),
  sharp: profile(1440, 30, 5_000_000, "L1T2"),
  ultra: profile(2160, 60, 12_000_000, "L1T3"),
});

export const SCREEN_SHARE_QUALITY_LABEL: Record<ScreenShareQualityId, string> = {
  economy: "Oszczędna",
  balanced: "Zrównoważona",
  sharp: "Wyraźna",
  ultra: "Ultra",
};

export const SCREEN_SHARE_QUALITY_HINT: Record<ScreenShareQualityId, string> = {
  economy: "Do 720p i 15 kl./s, około 1 Mb/s. Dobra przy słabszym wysyłaniu.",
  balanced: "Do 1080p i 30 kl./s, około 2,5 Mb/s. Najlepszy wybór na co dzień.",
  sharp: "Do 1440p i 30 kl./s, około 5 Mb/s. Czytelniejszy tekst i interfejsy.",
  ultra: "Do 2160p i 60 kl./s, około 12 Mb/s na każdą osobę w rozmowie.",
};

/** The default profile's limits, for callers that do not take a quality. */
export const SCREEN_MAX_BITRATE = SCREEN_SHARE_PROFILES[DEFAULT_SCREEN_SHARE_QUALITY].maxBitrate;
export const SCREEN_MAX_HEIGHT = SCREEN_SHARE_PROFILES[DEFAULT_SCREEN_SHARE_QUALITY].maxHeight;
export const SCREEN_MAX_FRAMERATE =
  SCREEN_SHARE_PROFILES[DEFAULT_SCREEN_SHARE_QUALITY].maxFramerate;

export type ScreenShareFailureKind = "unsupported" | "denied" | "cancelled" | "unavailable";

export class ScreenShareError extends Error {
  constructor(
    readonly kind: ScreenShareFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "ScreenShareError";
  }
}

export interface ScreenCapture {
  stream: MediaStream;
  video: MediaStreamTrack;
  /** Present only when the picker actually granted system or tab audio. */
  audio: MediaStreamTrack | null;
}

/**
 * Chromium-specific hints, all optional and ignored elsewhere.
 *
 * `systemAudio: "include"` is what makes tab and system sound available at all;
 * `surfaceSwitching: "include"` lets the person change what they share without
 * starting over; `selfBrowserSurface: "exclude"` keeps this tab out of the
 * picker, which otherwise invites an infinite hall of mirrors.
 */
interface ChromiumDisplayMediaOptions extends DisplayMediaStreamOptions {
  systemAudio?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
}

type GetDisplayMedia = (options: DisplayMediaStreamOptions) => Promise<MediaStream>;

export function screenTrackConstraints(
  quality: ScreenShareQualityId = DEFAULT_SCREEN_SHARE_QUALITY,
): MediaTrackConstraints {
  const { maxHeight, maxFramerate } = SCREEN_SHARE_PROFILES[quality];
  return { height: { max: maxHeight }, frameRate: { max: maxFramerate } };
}

export function displayMediaConstraints(
  quality: ScreenShareQualityId = DEFAULT_SCREEN_SHARE_QUALITY,
): ChromiumDisplayMediaOptions {
  return {
    video: screenTrackConstraints(quality),
    // Asking for audio is not getting it: Chromium offers the checkbox only for
    // a tab or the whole system, and only on some platforms. Shared sound is
    // content, so no speech processing runs over it.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: "include",
    surfaceSwitching: "include",
    selfBrowserSurface: "exclude",
  };
}

function browserGetDisplayMedia(): GetDisplayMedia | null {
  if (typeof navigator === "undefined") return null;
  const media = navigator.mediaDevices as
    | (MediaDevices & { getDisplayMedia?: GetDisplayMedia })
    | undefined;
  const getDisplayMedia = media?.getDisplayMedia;
  return getDisplayMedia ? (options) => getDisplayMedia.call(media, options) : null;
}

/**
 * Must be called synchronously from the click that asked for it, or the browser
 * discards the user gesture and rejects.
 */
export async function captureScreen(
  getDisplayMedia: GetDisplayMedia | null = browserGetDisplayMedia(),
  quality: ScreenShareQualityId = DEFAULT_SCREEN_SHARE_QUALITY,
): Promise<ScreenCapture> {
  if (!getDisplayMedia) {
    throw new ScreenShareError(
      "unsupported",
      "Ta przeglądarka nie potrafi udostępnić ekranu. Wymagane jest połączenie HTTPS.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await getDisplayMedia(displayMediaConstraints(quality));
  } catch (cause) {
    throw classifyScreenError(cause);
  }

  const video = stream.getVideoTracks()[0];
  if (!video) {
    for (const track of stream.getTracks()) track.stop();
    throw new ScreenShareError(
      "unavailable",
      "Nie udało się pobrać obrazu ekranu. Spróbuj ponownie.",
    );
  }

  // Desktop content is text and sharp edges, not motion: the hint tells the
  // encoder to hold resolution rather than smooth frames.
  video.contentHint = "detail";

  const audio = stream.getAudioTracks()[0] ?? null;
  if (audio) audio.contentHint = "music";

  return { stream, video, audio };
}

/**
 * Cancelling the picker and being blocked by policy both surface as
 * `NotAllowedError`. They are told apart by the message, because saying
 * "access was blocked" to someone who pressed Escape is wrong.
 */
export function classifyScreenError(cause: unknown): ScreenShareError {
  const name = cause instanceof DOMException ? cause.name : "";
  // The message is read structurally: DOMException does not extend Error in
  // every environment, so an `instanceof Error` check would lose it.
  const raw = (cause as { message?: unknown } | null)?.message;
  const message = typeof raw === "string" ? raw.toLowerCase() : "";

  switch (name) {
    case "NotAllowedError":
      return message.includes("permission denied by system") || message.includes("disallowed")
        ? new ScreenShareError(
            "denied",
            "System zablokował udostępnianie ekranu. Sprawdź uprawnienia i spróbuj ponownie.",
          )
        : new ScreenShareError("cancelled", "Udostępnianie ekranu anulowane.");
    case "NotFoundError":
    case "NotReadableError":
    case "AbortError":
      return new ScreenShareError(
        "unavailable",
        "Nie udało się pobrać obrazu ekranu. Spróbuj ponownie.",
      );
    case "NotSupportedError":
      return new ScreenShareError(
        "unsupported",
        "Ta przeglądarka nie potrafi udostępnić ekranu. Wymagane jest połączenie HTTPS.",
      );
    default:
      return new ScreenShareError(
        "unavailable",
        "Nie udało się udostępnić ekranu. Spróbuj ponownie.",
      );
  }
}

/** Encoding parameters for the screen sender. */
export function screenEncoding(
  quality: ScreenShareQualityId = DEFAULT_SCREEN_SHARE_QUALITY,
): ScreenRtpEncodingParameters {
  const { maxBitrate, maxFramerate, scalabilityMode } = SCREEN_SHARE_PROFILES[quality];
  return {
    maxBitrate,
    maxFramerate,
    // Dropping frames is far less damaging than blurring a terminal.
    scaleResolutionDownBy: 1,
    // Voice senders use high priority; the screen yields first when the uplink
    // narrows, otherwise a 4K share can damage the conversation.
    priority: "medium",
    networkPriority: "medium",
    scalabilityMode,
  };
}
