import { translateMessage, type MessageKey, type Translator } from "@/i18n";
import type { VoiceError } from "@/lib/voice/types";

export interface VoiceProblem {
  kind: VoiceError["kind"];
  title: string;
  message: string;
  /** A recoverable sub-action must not make a working call look disconnected. */
  recoverable: boolean;
}

const MESSAGE_KEY: Record<VoiceError["kind"], MessageKey> = {
  "mic-denied": "voiceError.micDenied",
  "mic-unavailable": "voiceError.micUnavailable",
  unsupported: "voiceError.unsupported",
  "ice-config": "voiceError.iceConfig",
  signaling: "voiceError.signaling",
  transport: "voiceError.transport",
  "session-replaced": "voiceError.sessionReplaced",
  "channel-kicked": "voiceError.channelKicked",
  camera: "voiceError.camera",
  "screen-share": "voiceError.screenShare",
};

const TITLE_KEY: Record<VoiceError["kind"], MessageKey> = {
  "mic-denied": "voiceError.titleMic",
  "mic-unavailable": "voiceError.titleMic",
  unsupported: "voiceError.titleUnsupported",
  "ice-config": "voiceError.titleIceConfig",
  signaling: "voiceError.titleSignaling",
  transport: "voiceError.titleTransport",
  "session-replaced": "voiceError.titleSessionReplaced",
  "channel-kicked": "voiceError.titleChannelKicked",
  camera: "voiceError.titleCamera",
  "screen-share": "voiceError.titleScreenShare",
};

const defaultTranslator: Translator = (key, values) =>
  translateMessage("pl", key, values);

/** The sentence the room shows for an RTC failure, or null when there is none. */
export function voiceErrorForUi(
  error: VoiceError | null,
  t: Translator = defaultTranslator,
): string | null {
  if (error === null) return null;
  // A recoverable failure already names the participant, device or permission
  // involved. A broad sentence in its place would read better and help less.
  if (error.recoverable === true || error.kind === "camera" || error.kind === "screen-share") {
    return error.message;
  }
  return t(MESSAGE_KEY[error.kind]);
}

export function voiceProblemForUi(
  error: VoiceError | null,
  t: Translator = defaultTranslator,
): VoiceProblem | null {
  const message = voiceErrorForUi(error, t);
  if (error === null || message === null) return null;
  return {
    kind: error.kind,
    title: t(TITLE_KEY[error.kind]),
    message,
    recoverable: error.recoverable === true,
  };
}
