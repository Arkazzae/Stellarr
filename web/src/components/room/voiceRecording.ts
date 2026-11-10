import type { Translator } from "@/i18n";
import { VoiceMessageCaptureError } from "@/ports";

export const MAX_VOICE_MESSAGE_SECONDS = 10 * 60;
export const MIN_VOICE_MESSAGE_SECONDS = 0.5;
export const LEVEL_SAMPLE_MS = 80;

/**
 * How many bars the recorder draws.
 *
 * Not the transcript's count. That one is measured for a 420px row; the
 * composer's row is the width of the whole room, and 56 bars stretched across
 * it are 8px wide and 3px tall, a line of squares rather than a waveform.
 * This many fill the row on a three-pixel rhythm.
 *
 * At one sample every `LEVEL_SAMPLE_MS` it is also how much of the recording
 * the live tape holds: a little over half a minute, scrolling.
 */
export const BAR_COUNT = 240;

/** Best container first; the first one this browser can record wins. */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function preferredRecordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(type: string): string {
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4")) return "m4a";
  return "webm";
}

/**
 * The file a finished recording is sent as. The extension follows the type the
 * browser really produced, which can differ from the one asked for.
 */
export function voiceMessageFile(blob: Blob, recordedAt: Date): File {
  const stamp = recordedAt.toISOString().replace(/[:.]/g, "-");
  return new File(
    [blob],
    `wiadomosc-glosowa-${stamp}.${extensionFor(blob.type)}`,
    { type: blob.type },
  );
}

/** The sentence for a failed attempt to open the microphone. */
export function captureErrorMessage(t: Translator, error: unknown): string {
  if (error instanceof VoiceMessageCaptureError) return error.message;
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return t("recorder.allowMic");
      case "NotFoundError":
      case "DevicesNotFoundError":
        return t("recorder.noMic");
      case "NotReadableError":
        return t("recorder.micBusy");
    }
  }
  return t("recorder.startFailed");
}
