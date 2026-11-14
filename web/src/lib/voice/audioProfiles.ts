import { OPUS_PROFILE_KBPS } from "./opusRates";
import type { NoiseSuppressionMode, OpusProfileId, VoiceSettings } from "./settings";

/**
 * Opus is configured, never replaced.
 *
 * WebRTC mandates Opus (RFC 7874), and the only supported tuning surfaces are
 * fmtp parameters in the SDP and `RTCRtpSender.setParameters`. Every profile
 * below expresses its target through those two:
 *
 * - `useinbandfec=1`: RFC 8854 recommends Opus's built-in FEC for WebRTC. It
 *   repairs a lost packet from the next one, the biggest quality win on a home
 *   uplink.
 * - `usedtx=0` for quality speech: continuous transmission leaves Opus no onset
 *   decision to get wrong. Only the bandwidth-saving profile uses DTX. The
 *   application gate (see `micPipeline`) works in the capture graph with
 *   lookahead, so Opus still sees a continuous stream.
 * - `stereo=0` for speech: one voice, one channel; the bits go to quality.
 * - `minptime=10` with `a=ptime:20`: 20 ms packets, the Opus default and the
 *   best latency/overhead trade for speech.
 */
export type AudioProfileId = OpusProfileId | "music";

export interface AudioProfile {
  id: AudioProfileId;
  /** Ceiling handed to `setParameters` and to `maxaveragebitrate`. */
  maxBitrate: number;
  /** Floor the adaptive controller may never go below. */
  minBitrate: number;
  stereo: boolean;
  dtx: boolean;
  ptime: number;
  contentHint: "speech" | "music";
}

function speechProfile(
  id: OpusProfileId,
  maxBitrate: number,
  minBitrate: number,
  dtx = false,
): AudioProfile {
  return { id, maxBitrate, minBitrate, stereo: false, dtx, ptime: 20, contentHint: "speech" };
}

export const AUDIO_PROFILES: Record<AudioProfileId, AudioProfile> = {
  economy: speechProfile("economy", OPUS_PROFILE_KBPS.economy * 1000, 16_000, true),
  balanced: speechProfile("balanced", OPUS_PROFILE_KBPS.balanced * 1000, 24_000),
  clarity: speechProfile("clarity", OPUS_PROFILE_KBPS.clarity * 1000, 32_000),
  premium: speechProfile("premium", OPUS_PROFILE_KBPS.premium * 1000, 64_000),
  // Opus can spend roughly 256 kb/s on one full-band mono channel. Above that a
  // voice microphone gains no useful detail, and stereo would only encode room
  // position while doubling what every listener has to receive.
  studio: speechProfile("studio", OPUS_PROFILE_KBPS.studio * 1000, 96_000),
  // Shared screen audio is music, a video soundtrack or a game, not speech. DTX
  // would clip the quiet passages it is meant to carry, and stereo is part of
  // the content rather than a luxury.
  music: {
    id: "music",
    maxBitrate: 160_000,
    minBitrate: 96_000,
    stereo: true,
    dtx: false,
    ptime: 20,
    contentHint: "music",
  },
};

export function profileFor(settings: VoiceSettings): AudioProfile {
  return AUDIO_PROFILES[settings.opusProfile];
}

/**
 * fmtp parameters for a profile, ready to merge into an audio m-section.
 * `stereoSupported` is what the remote description allows; a stereo profile
 * falls back to mono when the peer did not offer stereo.
 */
export function opusParameters(
  profile: AudioProfile,
  stereoSupported = profile.stereo,
): Record<string, string> {
  const stereo = profile.stereo && stereoSupported ? "1" : "0";
  return {
    useinbandfec: "1",
    usedtx: profile.dtx ? "1" : "0",
    maxaveragebitrate: String(profile.maxBitrate),
    stereo,
    "sprop-stereo": stereo,
    minptime: "10",
  };
}

/**
 * Microphone constraints for the chosen settings.
 *
 * Only the browser's own suppressor is ever left on, and only when it is the
 * chosen one. With a worklet suppressor it is switched off rather than stacked
 * underneath: two noise gates in series chew holes in speech, and the browser's
 * would run first, so the worklet would only ever see already-damaged audio.
 * Echo cancellation stays under the person's control either way. It is not a
 * "noise" feature, and switching it off with speakers is how a call turns into
 * a feedback loop.
 */
export function microphoneConstraints(settings: VoiceSettings): MediaTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    // Automatic volume is our own leveller in the capture graph (see
    // `micPipeline`): it learns only from vowels, so it cannot turn the room up
    // between sentences the way the platform AGC does. The device is therefore
    // opened with the browser's AGC off whether or not the person wants
    // automatic volume; the pipeline switches it back on only when the graph
    // cannot be built.
    autoGainControl: false,
    noiseSuppression: settings.noiseSuppression === "browser",
    channelCount: 1,
    sampleRate: 48_000,
    ...(settings.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : {}),
  };
}

/** The suppressors that run as an AudioWorklet in our own capture graph. */
export type WorkletSuppressor = Extract<NoiseSuppressionMode, "rnnoise" | "gtcrn" | "speex">;

/** True when the pipeline has to insert a suppressor worklet of its own. */
export function usesWorkletSuppression(
  mode: NoiseSuppressionMode | string,
): mode is WorkletSuppressor {
  return mode === "rnnoise" || mode === "gtcrn" || mode === "speex";
}
