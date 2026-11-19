import type { VoiceSettings } from "../settings";

/** Whether this browser can route a media element to a chosen output device. */
export function audioOutputSelectionSupported(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    typeof HTMLMediaElement.prototype.setSinkId === "function"
  );
}

/**
 * Applies the call's playback preferences to one media element.
 *
 * Volume works everywhere. Choosing a speaker is an extra, so callers may
 * ignore the rejection and keep playing on the system default; it is rejected
 * rather than swallowed so the settings screen can say why the choice failed.
 */
export async function applyAudioOutput(
  element: HTMLMediaElement,
  { outputDeviceId, outputVolume }: Pick<VoiceSettings, "outputDeviceId" | "outputVolume">,
): Promise<void> {
  element.volume = Math.min(1, Math.max(0, outputVolume / 100));
  await routeAudioOutput(element, outputDeviceId);
}

/**
 * Sends one media element to the chosen speaker and leaves its level alone,
 * for sound that is not mixed at the call's output level. Rejected where the
 * choice cannot be made, as `applyAudioOutput` is.
 */
export async function routeAudioOutput(
  element: HTMLMediaElement,
  outputDeviceId: VoiceSettings["outputDeviceId"],
): Promise<void> {
  if (audioOutputSelectionSupported()) {
    // An empty sink id is the platform's way to say "the default device".
    await element.setSinkId(outputDeviceId ?? "");
  } else if (outputDeviceId !== null) {
    throw new DOMException("Audio output selection is unsupported", "NotSupportedError");
  }
}
