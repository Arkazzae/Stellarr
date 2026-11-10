import type { VoiceSettingsStore } from "@/lib/voice/settings";
import type { VoiceSettingsPort } from "@/ports";

/**
 * `VoiceSettingsPort` over the store the WebRTC client also reads, so a change
 * made in the settings pane reaches a live call without dropping it. The store
 * persists, validates and notifies; this only keeps components off `@/lib/voice`.
 */
export function createVoiceSettingsAdapter(
  store: VoiceSettingsStore,
): VoiceSettingsPort {
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,

    update(patch) {
      // The version belongs to the store's migrations. A stray one in a patch
      // would make the store discard every setting as coming from another build.
      const { version: _version, ...settings } = patch;
      store.update(settings);
    },

    reset() {
      store.reset();
    },
  };
}
