import { useEffect, useState } from "react";

import { CallMediaSessionController } from "@/lib/voice/mediaSession";

interface CallMediaSessionInput {
  /** The room's name, or null when there is no call to publish. */
  title: string | null;
  subtitle: string;
  muted: boolean;
  cameraActive: boolean;
  onToggleMute: () => void;
  onHangup: () => void;
}

/**
 * Publishes the call to the browser's Media Session, so a lock screen or a
 * headset can show it and offer mute and hang-up.
 */
export function useCallMediaSession({
  title,
  subtitle,
  muted,
  cameraActive,
  onToggleMute,
  onHangup,
}: CallMediaSessionInput) {
  const [controller] = useState(() => new CallMediaSessionController());

  useEffect(() => {
    if (title === null) {
      controller.sync(null);
      return;
    }
    controller.sync({ title, subtitle, muted, cameraActive, onToggleMute, onHangup });
  }, [controller, title, subtitle, muted, cameraActive, onToggleMute, onHangup]);

  useEffect(() => () => controller.dispose(), [controller]);
}
