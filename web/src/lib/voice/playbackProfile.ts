import {
  PLAYBACK_TUNING_PRESETS,
  type PlaybackProfileId,
  type PlaybackTuning,
} from "./settings";

/** One intentional voice curve, expressed as native Web Audio parameters. */
export interface PlaybackProfile {
  id: PlaybackProfileId;
  highpassHz: number;
  warmthDb: number;
  mudDb: number;
  presenceDb: number;
  airDb: number;
  compressorThresholdDb: number;
  compressorKneeDb: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
  compressorMakeupGain: number;
}

const HIGHPASS_HZ: Record<PlaybackProfileId, number> = {
  off: 10,
  natural: 52,
  studio: 76,
  broadcast: 92,
  custom: 76,
};

type Dynamics = Pick<
  PlaybackProfile,
  | "compressorThresholdDb"
  | "compressorKneeDb"
  | "compressorRatio"
  | "compressorAttack"
  | "compressorRelease"
  | "compressorMakeupGain"
>;

/** What a compressor set to do nothing looks like; the strip stays wired. */
const BYPASSED_DYNAMICS: Dynamics = {
  compressorThresholdDb: 0,
  compressorKneeDb: 0,
  compressorRatio: 1,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  compressorMakeupGain: 1,
};

/** `amount` is the 0..1 strength of the tuning's compression dial. */
function dynamicsFor(amount: number): Dynamics {
  if (amount === 0) return BYPASSED_DYNAMICS;
  return {
    compressorThresholdDb: -8 - 22 * amount,
    compressorKneeDb: 6 + 12 * amount,
    compressorRatio: 1 + 5 * amount,
    compressorAttack: 0.012 - 0.009 * amount,
    compressorRelease: 0.14 + 0.16 * amount,
    // Up to +6 dB, so the levelled voice is not quieter than the raw one.
    compressorMakeupGain: 10 ** ((6 * amount) / 20),
  };
}

/**
 * Local listening profiles. They never touch the received MediaStream, RTP or
 * another participant's microphone. Presets are intentionally audible so the
 * looped preview provides a useful A/B comparison; the limiter catches their
 * added energy before it can clip.
 */
export function resolvePlaybackProfile(
  id: PlaybackProfileId,
  tuning: PlaybackTuning,
): PlaybackProfile {
  const effective = id === "custom" ? tuning : PLAYBACK_TUNING_PRESETS[id];
  const amount = Math.min(100, Math.max(0, effective.compression)) / 100;

  return {
    id,
    highpassHz: HIGHPASS_HZ[id],
    warmthDb: effective.warmthDb,
    mudDb: effective.mudDb,
    presenceDb: effective.presenceDb,
    airDb: effective.airDb,
    ...dynamicsFor(amount),
  };
}

export const PLAYBACK_PROFILES: Record<
  Exclude<PlaybackProfileId, "custom">,
  PlaybackProfile
> = {
  off: resolvePlaybackProfile("off", PLAYBACK_TUNING_PRESETS.off),
  natural: resolvePlaybackProfile("natural", PLAYBACK_TUNING_PRESETS.natural),
  studio: resolvePlaybackProfile("studio", PLAYBACK_TUNING_PRESETS.studio),
  broadcast: resolvePlaybackProfile("broadcast", PLAYBACK_TUNING_PRESETS.broadcast),
};
