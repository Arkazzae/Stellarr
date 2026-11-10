import type { Translator } from "@/i18n";
import type { RtcConfig } from "@/lib/api/types";
import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import { usesWorkletSuppression, type WorkletSuppressor } from "./audioProfiles";
import { CameraCaptureError } from "./camera";
import { IceConfigError } from "./iceSession";
import {
  MicCaptureError,
  type ActiveAutoGain,
  type ActiveNoiseSuppression,
} from "./micPipeline";
import { ScreenShareError } from "./screenShare";
import type { VoiceSettings } from "./settings";
import type { VoiceError } from "./types";

/**
 * Everything the WebRTC client tells the person when something goes wrong.
 * The wording lives in the catalog and the choice of sentence here, away from
 * the logic that decides when to say it. A sentence is composed when the
 * failure happens, by the translator the client was given, so these are
 * functions of it rather than constants.
 */

/** Why this client cannot speak the server's RTC contract, or null when it can. */
export function rtcIncompatibility(
  t: Translator,
  config: Pick<RtcConfig, "protocolVersion" | "topology">,
): string | null {
  if (config.protocolVersion !== RTC_PROTOCOL_VERSION) {
    return t("voiceClient.rtcVersion", {
      version: config.protocolVersion,
      supported: RTC_PROTOCOL_VERSION,
    });
  }
  if (config.topology !== "mesh") {
    return t("voiceClient.rtcTopology", { topology: config.topology });
  }
  return null;
}

export function micError(t: Translator, cause: unknown): VoiceError {
  if (cause instanceof MicCaptureError) {
    const kind =
      cause.kind === "denied"
        ? "mic-denied"
        : cause.kind === "unsupported"
          ? "unsupported"
          : "mic-unavailable";
    return { kind, message: cause.message };
  }
  return { kind: "mic-unavailable", message: t("voiceClient.micMissing") };
}

/** Expired credentials and an unreachable server call for different retries. */
export function iceConfigError(t: Translator, cause: unknown): VoiceError {
  const expired = cause instanceof IceConfigError && cause.kind === "expired";
  return {
    kind: "ice-config",
    message: expired ? t("voiceClient.iceExpired") : t("voiceClient.iceUnavailable"),
  };
}

export const joinFailedError = (t: Translator): VoiceError => ({
  kind: "signaling",
  message: t("voiceClient.joinFailed"),
});

export const moveFailedError = (t: Translator): VoiceError => ({
  kind: "signaling",
  message: t("voiceClient.moveFailed"),
});

export const rejoinFailedError = (t: Translator): VoiceError => ({
  kind: "signaling",
  message: t("voiceClient.rejoinFailed"),
  recoverable: true,
});

export const signalingFailedError = (t: Translator): VoiceError => ({
  kind: "signaling",
  message: t("voiceClient.signalingFailed"),
  recoverable: true,
});

export const sessionReplacedError: VoiceError = {
  kind: "session-replaced",
  message: "A newer connection for this account replaced this voice session.",
};

export const channelKickedError: VoiceError = {
  kind: "channel-kicked",
  message: "A moderator disconnected this voice session from the channel.",
};

export const micSwapFailedError = (t: Translator): VoiceError => ({
  kind: "mic-unavailable",
  message: t("voiceClient.micSwapFailed"),
  recoverable: true,
});

/** A camera that would not open leaves the call untouched, so it is recoverable. */
export function cameraError(t: Translator, cause: unknown): VoiceError {
  const message =
    cause instanceof CameraCaptureError
      ? cause.message
      : t("voiceClient.cameraFailed");
  return { kind: "camera", message, recoverable: true };
}

export const cameraLostError = (t: Translator): VoiceError => ({
  kind: "camera",
  message: t("voiceClient.cameraLost"),
  recoverable: true,
});

export const cameraSwapFailedError = (t: Translator): VoiceError => ({
  kind: "camera",
  message: t("voiceClient.cameraSwapFailed"),
  recoverable: true,
});

/** What a failed share says. Cancelling the picker is a decision, so it has no error. */
export function screenShareError(t: Translator, cause: unknown): VoiceError | null {
  const failure = cause instanceof ScreenShareError ? cause : null;
  if (failure?.kind === "cancelled") return null;
  return {
    kind: "screen-share",
    message: failure?.message ?? t("voiceClient.screenShareFailed"),
    recoverable: true,
  };
}

export const screenQualityPartialError = (t: Translator): VoiceError => ({
  kind: "screen-share",
  message: t("voiceClient.screenQualityPartial"),
  recoverable: true,
});

export const iceRefreshFailedError = (t: Translator): VoiceError => ({
  kind: "ice-config",
  message: t("voiceClient.iceRefreshFailed"),
  recoverable: true,
});

export const iceRefreshPartialError = (t: Translator): VoiceError => ({
  kind: "ice-config",
  message: t("voiceClient.iceRefreshPartial"),
  recoverable: true,
});

export function peerStalledError(t: Translator, displayName: string): VoiceError {
  return {
    kind: "transport",
    message: t("voiceClient.peerStalled", { name: displayName }),
    recoverable: true,
  };
}

export function peerLostError(t: Translator, displayName: string): VoiceError {
  return {
    kind: "transport",
    message: t("voiceClient.peerLost", { name: displayName }),
    recoverable: true,
  };
}

const SUPPRESSOR_NAME: Record<WorkletSuppressor, string> = {
  rnnoise: "RNNoise",
  gtcrn: "GTCRN",
  speex: "Speex",
};

/**
 * The honest sentence for a requested-versus-actual mismatch.
 *
 * Returns null when they agree, including "off" meaning off, which is a
 * choice rather than a degradation.
 */
export function degradedNotice(
  t: Translator,
  requested: VoiceSettings["noiseSuppression"],
  actual: ActiveNoiseSuppression,
  gate: { requested: boolean; active: boolean } = { requested: false, active: false },
  autoGain: { requested: boolean; active: ActiveAutoGain } = {
    requested: false,
    active: "none",
  },
): string | null {
  const notices: string[] = [];

  if (usesWorkletSuppression(requested) && actual !== requested) {
    const name = SUPPRESSOR_NAME[requested];
    if (actual === "browser") {
      notices.push(t("voiceClient.suppressorFellBackToBrowser", { name }));
    } else if (usesWorkletSuppression(actual)) {
      notices.push(
        t("voiceClient.suppressorFellBackToOther", { name, other: SUPPRESSOR_NAME[actual] }),
      );
    } else {
      notices.push(t("voiceClient.suppressorFailed", { name }));
    }
  }

  if (gate.requested && !gate.active) {
    notices.push(t("voiceClient.gateMissing"));
  }

  // The browser's own AGC taking over is a quieter downgrade, since the level
  // is still kept, only by a leveller that also turns the room up. Losing
  // automatic volume altogether gets a plainer sentence.
  if (autoGain.requested && autoGain.active === "browser") {
    notices.push(t("voiceClient.autoGainBrowser"));
  } else if (autoGain.requested && autoGain.active === "none") {
    notices.push(t("voiceClient.autoGainMissing"));
  }

  return notices.length > 0 ? notices.join(" ") : null;
}
