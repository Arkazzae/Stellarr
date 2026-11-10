import { useEffect, useSyncExternalStore } from "react";

import {
  disconnectedDeviceFallbacks,
  snapshotVoiceDevices,
  watchVoiceDevices,
  type VoiceDeviceSnapshot,
} from "@/lib/voice/deviceMonitor";
import type { Ports } from "@/ports";

import type { VoiceHolder } from "./voiceHolder";

interface VoiceSyncInput {
  holder: VoiceHolder;
  ports: Pick<Ports, "voiceSettings" | "soundboard">;
  /** Null while signed out, when there is no client and nothing to watch. */
  userId: string | null;
  /** The "join and leave sounds" preference. */
  arrivals: boolean;
  deafened: boolean;
}

/**
 * Pushes local choices into the live voice client and the soundboard.
 *
 * Call it after the effect that attaches the client: on first mount the new
 * client must see these values, and effects run in declaration order.
 */
export function useVoiceSettingsSync({ holder, ports, userId, arrivals, deafened }: VoiceSyncInput) {
  const { voiceSettings, soundboard } = ports;
  const settings = useSyncExternalStore(
    voiceSettings.subscribe,
    voiceSettings.getSnapshot,
    voiceSettings.getSnapshot,
  );

  // Keep persisted choices valid even outside a call. A device id lasts only
  // while the hardware exists; keeping a vanished USB headset would pin every
  // later capture to an exact constraint nothing can satisfy.
  useEffect(() => {
    if (userId === null) return;
    let previous: VoiceDeviceSnapshot | null = null;
    return watchVoiceDevices((devices) => {
      const next = snapshotVoiceDevices(devices);
      const before = previous;
      previous = next;
      if (before === null) return;
      const patch = disconnectedDeviceFallbacks(voiceSettings.getSnapshot(), before, next);
      if (Object.keys(patch).length > 0) voiceSettings.update(patch);
    });
  }, [voiceSettings, userId]);

  // The client reads the snapshot before a join and then follows every change
  // while it is alive. Screen quality is a local sender preference that
  // channels never cap or rewrite.
  useEffect(() => {
    void holder.getClient()?.applySettings(settings);
  }, [holder, settings]);

  useEffect(() => {
    soundboard.setVolume(settings.soundboardVolume);
  }, [soundboard, settings.soundboardVolume]);

  // One answer about arrivals silences both halves of the announcement: the
  // shared chime and the clip somebody chose for themselves. It is pushed in
  // because the preference belongs to the listener, and the soundboard has no
  // business knowing whose account is signed in.
  useEffect(() => {
    soundboard.setArrivalsAudible(arrivals);
  }, [soundboard, arrivals]);

  // Also runs after a user swap, when a newly attached client has not seen the
  // click that established the current state.
  useEffect(() => {
    holder.getClient()?.setDeafened(deafened);
    soundboard.setDeafened(deafened);
  }, [holder, soundboard, deafened]);
}
