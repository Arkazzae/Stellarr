/**
 * Short feedback sounds for the app shell: joining, muting, a ringing call.
 *
 * Voice media and the soundboard use their own transports. These clips are
 * local UI feedback with one volume policy, and playing one must never make
 * the action it accompanies fail.
 */

export type SystemFxName =
  | "calling"
  | "join"
  | "leave"
  | "mute"
  | "notification"
  | "stream"
  | "unmute";

interface SystemFxDefinition {
  src: string;
  /** How loud the clip is by default; callers pass a multiplier only when they must. */
  volume: number;
  loop?: boolean;
}

export const SYSTEM_FX: Readonly<Record<SystemFxName, SystemFxDefinition>> = {
  calling: { src: "/sounds/calling.wav", volume: 0.72, loop: true },
  join: { src: "/sounds/join-effect.wav", volume: 0.8 },
  leave: { src: "/sounds/leave-effect.wav", volume: 0.8 },
  mute: { src: "/sounds/mute.wav", volume: 0.5 },
  notification: { src: "/sounds/notification.wav", volume: 0.8 },
  stream: { src: "/sounds/stream.wav", volume: 0.8 },
  unmute: { src: "/sounds/unmute.wav", volume: 0.5 },
};

/** One element per clip, kept so a repeated sound does not reload its file. */
const clips = new Map<SystemFxName, HTMLAudioElement>();

/** Loops that were started and not yet stopped or refused by the browser. */
const runningLoops = new Set<SystemFxName>();

function clipFor(name: SystemFxName): HTMLAudioElement | null {
  const known = clips.get(name);
  if (known !== undefined) return known;

  try {
    const { src, loop = false } = SYSTEM_FX[name];
    const clip = new Audio(src);
    clip.preload = "auto";
    clip.loop = loop;
    clips.set(name, clip);
    return clip;
  } catch {
    // There is no Audio on the server, and a restricted document may refuse
    // it. Either way the sound is optional.
    return null;
  }
}

/**
 * Plays a clip from its start. A one-shot played again restarts, which keeps
 * quick toggles crisp. A loop does nothing while it is already running.
 */
export function playSystemFx(name: SystemFxName, volume = 1): void {
  const { volume: standardVolume, loop = false } = SYSTEM_FX[name];
  if (loop && runningLoops.has(name)) return;

  const clip = clipFor(name);
  if (clip === null) return;

  // A blocked autoplay leaves a loop unstarted, so it must be startable again.
  const notStarted = () => void runningLoops.delete(name);
  try {
    clip.volume = Math.min(1, Math.max(0, standardVolume * volume));
    clip.currentTime = 0;
    if (loop) runningLoops.add(name);
    clip.play().catch(notStarted);
  } catch {
    // `play()` can throw at once in an embedded or locked-down browser.
    notStarted();
  }
}

/** Stops a clip and rewinds it. Safe for a clip that never played. */
export function stopSystemFx(name: SystemFxName): void {
  runningLoops.delete(name);
  const clip = clips.get(name);
  if (clip === undefined) return;

  try {
    clip.pause();
    clip.currentTime = 0;
  } catch {
    // Stopping is best-effort for the same reason playing is.
  }
}

/** For tearing the shell down, so a ringing call cannot outlive it. */
export function stopAllSystemFx(): void {
  for (const name of clips.keys()) stopSystemFx(name);
}
