import type { ActiveAutoGain, ActiveNoiseSuppression } from "./micCapture";
import type { NoiseSuppressionMode } from "./settings";

/** What the platform is doing on a track, for the jobs our graph did not take. */
export interface BrowserProcessing {
  noiseSuppression: ActiveNoiseSuppression;
  autoGain: ActiveAutoGain;
}

/** Which of the browser's own features to switch back on. */
export interface WantedBrowserProcessing {
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

const NOTHING: BrowserProcessing = { noiseSuppression: "none", autoGain: "none" };

/**
 * Best-effort: turn the browser's own noise suppression and/or AGC back on
 * after the graph stage that replaced them failed, and report what the device
 * is really doing.
 *
 * `applyConstraints` can reject (a device that cannot do it, a track that has
 * already ended) and it can silently do nothing, so the result is read back
 * from `getSettings()` rather than assumed. A failure here is never fatal:
 * unprocessed audio is worse than processed audio, but no audio is worse than
 * both.
 */
export async function restoreBrowserProcessing(
  track: MediaStreamTrack,
  wanted: WantedBrowserProcessing,
): Promise<BrowserProcessing> {
  if (!wanted.noiseSuppression && !wanted.autoGainControl) return NOTHING;
  if (typeof track.applyConstraints !== "function") return NOTHING;

  let active: MediaTrackConstraints = {};
  try {
    active = track.getConstraints?.() ?? {};
  } catch {
    // Some browser/device pairs expose getConstraints but throw once a track
    // changes state. The restore is still worth attempting.
  }
  try {
    // applyConstraints replaces the track's whole constraint set, so carry the
    // active echo-cancellation mode forward: a suppressor failure must not
    // silently downgrade a stronger `all` / `remote-only` voice isolation.
    await track.applyConstraints({
      ...active,
      ...(wanted.noiseSuppression ? { noiseSuppression: true } : {}),
      ...(wanted.autoGainControl ? { autoGainControl: true } : {}),
    });
  } catch {
    return NOTHING;
  }

  let applied: MediaTrackSettings | undefined;
  try {
    applied = track.getSettings?.();
  } catch {
    return NOTHING;
  }
  // `undefined` means the browser does not report the setting. The constraint
  // was accepted, so trust it rather than claiming failure.
  return {
    noiseSuppression: wanted.noiseSuppression
      ? applied?.noiseSuppression === false
        ? "none"
        : "browser"
      : "none",
    autoGain: wanted.autoGainControl
      ? applied?.autoGainControl === false
        ? "none"
        : "browser"
      : "none",
  };
}

/** The suppressor half of `restoreBrowserProcessing`, for callers that only lost that. */
export async function restoreBrowserNoise(
  track: MediaStreamTrack,
): Promise<ActiveNoiseSuppression> {
  const restored = await restoreBrowserProcessing(track, {
    noiseSuppression: true,
    autoGainControl: false,
  });
  return restored.noiseSuppression;
}

function reportedBrowserNoise(track: MediaStreamTrack): ActiveNoiseSuppression {
  try {
    return track.getSettings?.().noiseSuppression === false ? "none" : "browser";
  } catch {
    return "none";
  }
}

/**
 * What the device does for the jobs a graph stage was meant to do and is not
 * doing.
 *
 * The device is opened with the browser's suppressor and AGC off to make room
 * for ours. Whichever of ours is missing gets the browser's put back, and the
 * answer is what really happened. A suppressor that was never lost is reported
 * from the track: `browser` is only claimed when it was asked for and the device
 * confirms it.
 */
export async function browserFallback(
  track: MediaStreamTrack,
  requested: NoiseSuppressionMode,
  lost: { noise: boolean; autoGain: boolean },
): Promise<BrowserProcessing> {
  const restored = await restoreBrowserProcessing(track, {
    noiseSuppression: lost.noise,
    autoGainControl: lost.autoGain,
  });
  let noiseSuppression = restored.noiseSuppression;
  if (!lost.noise) {
    noiseSuppression = requested === "browser" ? reportedBrowserNoise(track) : "none";
  }
  return { noiseSuppression, autoGain: restored.autoGain };
}
