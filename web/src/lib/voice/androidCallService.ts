"use client";

import { getAndroidCallBridge } from "@/lib/android/callBridge";

/**
 * Tells Android's microphone foreground service whether a call is live, so the
 * app keeps capturing in the background. Browsers and the desktop client have
 * no bridge and see a no-op.
 */
export function setAndroidCallActive(active: boolean): void {
  try {
    getAndroidCallBridge()?.setActive?.(active);
  } catch {
    // Native background support is an extra. A bridge failure must never get
    // in the way of joining or leaving the WebRTC room itself.
  }
}
