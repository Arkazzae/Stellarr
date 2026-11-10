async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === kind);
  } catch {
    return [];
  }
}

/**
 * Input devices, once permission exists.
 *
 * Before permission the browser reports empty labels, so the settings panel
 * says "grant access first" rather than listing anonymous entries.
 */
export function listInputDevices(): Promise<MediaDeviceInfo[]> {
  return listDevices("audioinput");
}

/** Playback targets exposed by browsers that implement audio-output routing. */
export async function listOutputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await listDevices("audiooutput");
  // The empty sink id already means the system default. Chromium often also
  // publishes a synthetic `default` entry, which would present the same choice
  // twice and then persist an implementation detail instead of the rule.
  return devices.filter((device) => device.deviceId !== "default");
}

/** Cameras available to the local preview and the camera adapter. */
export function listVideoDevices(): Promise<MediaDeviceInfo[]> {
  return listDevices("videoinput");
}

export function hasDeviceLabels(devices: readonly MediaDeviceInfo[]): boolean {
  return devices.some((device) => device.label.length > 0);
}
