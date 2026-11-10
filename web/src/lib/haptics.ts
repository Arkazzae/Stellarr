"use client";

import { WebHaptics } from "web-haptics";

export type HapticCue = "selection" | "light";

let haptics: WebHaptics | null = null;

/**
 * Plays one cue from a deliberately small haptic vocabulary.
 *
 * The WebHaptics instance is created on the first call, never while rendering,
 * so server rendering stays inert and every caller shares one pattern queue.
 * Haptics only enhance an interaction, so a browser or device failure is
 * swallowed rather than turning a successful click into an error.
 */
export function triggerHaptic(cue: HapticCue): void {
  if (typeof window === "undefined") return;
  haptics ??= new WebHaptics();
  haptics.trigger(cue).catch(() => undefined);
}
