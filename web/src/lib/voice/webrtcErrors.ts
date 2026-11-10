import type { RtcConfig } from "@/lib/api/types";
import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import { usesWorkletSuppression, type WorkletSuppressor } from "./audioProfiles";
import { IceConfigError } from "./iceSession";
import {
  MicCaptureError,
  type ActiveAutoGain,
  type ActiveNoiseSuppression,
} from "./micPipeline";
import type { VoiceSettings } from "./settings";
import type { VoiceError } from "./types";

/**
 * Everything the WebRTC client tells the person when something goes wrong.
 * The wording lives here, away from the logic that decides when to say it.
 */

/** Why this client cannot speak the server's RTC contract, or null when it can. */
export function rtcIncompatibility(
  config: Pick<RtcConfig, "protocolVersion" | "topology">,
): string | null {
  if (config.protocolVersion !== RTC_PROTOCOL_VERSION) {
    return `Serwer używa nieobsługiwanej wersji RTC (${config.protocolVersion}); klient obsługuje v${RTC_PROTOCOL_VERSION}.`;
  }
  if (config.topology !== "mesh") {
    return `Ta wersja klienta nie obsługuje jeszcze topologii RTC: ${config.topology}.`;
  }
  return null;
}

export function micError(cause: unknown): VoiceError {
  if (cause instanceof MicCaptureError) {
    const kind =
      cause.kind === "denied"
        ? "mic-denied"
        : cause.kind === "unsupported"
          ? "unsupported"
          : "mic-unavailable";
    return { kind, message: cause.message };
  }
  return {
    kind: "mic-unavailable",
    message: "Brak dostępnego mikrofonu. Podłącz go i dołącz ponownie.",
  };
}

/** Expired credentials and an unreachable server call for different retries. */
export function iceConfigError(cause: unknown): VoiceError {
  const expired = cause instanceof IceConfigError && cause.kind === "expired";
  return {
    kind: "ice-config",
    message: expired
      ? "Konfiguracja połączenia głosowego wygasła i nie udało się jej odświeżyć. Spróbuj dołączyć ponownie."
      : "Nie udało się pobrać konfiguracji połączenia głosowego. Spróbuj dołączyć ponownie.",
  };
}

export const joinFailedError: VoiceError = {
  kind: "signaling",
  message: "Nie udało się dołączyć do rozmowy głosowej. Spróbuj ponownie.",
};

export const moveFailedError: VoiceError = {
  kind: "signaling",
  message: "Nie udało się przełączyć kanału głosowego. Dołącz ponownie.",
};

export const rejoinFailedError: VoiceError = {
  kind: "signaling",
  message: "Nie udało się wrócić do kanału głosowego. Spróbuj dołączyć ponownie.",
  recoverable: true,
};

export const signalingFailedError: VoiceError = {
  kind: "signaling",
  message: "Sygnalizacja głosowa zawiodła. Sprawdź połączenie i dołącz ponownie.",
  recoverable: true,
};

export const sessionReplacedError: VoiceError = {
  kind: "session-replaced",
  message: "A newer connection for this account replaced this voice session.",
};

export const channelKickedError: VoiceError = {
  kind: "channel-kicked",
  message: "A moderator disconnected this voice session from the channel.",
};

export const micSwapFailedError: VoiceError = {
  kind: "mic-unavailable",
  message:
    "Nie udało się przełączyć mikrofonu u wszystkich rozmówców. Poprzedni mikrofon nadal działa.",
  recoverable: true,
};

export const iceRefreshFailedError: VoiceError = {
  kind: "ice-config",
  message: "Nie udało się odświeżyć konfiguracji TURN. Ponawiam próbę.",
  recoverable: true,
};

export const iceRefreshPartialError: VoiceError = {
  kind: "ice-config",
  message: "Nie wszystkie połączenia przyjęły odświeżoną konfigurację TURN.",
  recoverable: true,
};

export function peerStalledError(displayName: string): VoiceError {
  return {
    kind: "transport",
    message: `Połączenie z ${displayName} nie przesyła pakietów audio.`,
    recoverable: true,
  };
}

export function peerLostError(displayName: string): VoiceError {
  return {
    kind: "transport",
    message: `Utracono połączenie audio z: ${displayName}.`,
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
      notices.push(`Nie udało się uruchomić ${name}. Działa redukcja szumu przeglądarki.`);
    } else if (usesWorkletSuppression(actual)) {
      notices.push(`Nie udało się uruchomić ${name}. Działa ${SUPPRESSOR_NAME[actual]}.`);
    } else {
      notices.push(
        `Nie udało się uruchomić ${name} ani redukcji szumu przeglądarki. Dźwięk jest nieprzetworzony.`,
      );
    }
  }

  if (gate.requested && !gate.active) {
    notices.push(
      "Bramka mikrofonu nie działa w tej przeglądarce. Rozmówcy słyszą wszystko, co zbiera mikrofon.",
    );
  }

  // The browser's own AGC taking over is a quieter downgrade, since the level
  // is still kept, only by a leveller that also turns the room up. Losing
  // automatic volume altogether gets a plainer sentence.
  if (autoGain.requested && autoGain.active === "browser") {
    notices.push(
      "Automatyczna głośność działa w wersji przeglądarki, która podbija też tło między zdaniami.",
    );
  } else if (autoGain.requested && autoGain.active === "none") {
    notices.push("Automatyczna głośność nie działa w tej przeglądarce.");
  }

  return notices.length > 0 ? notices.join(" ") : null;
}
