import type { VoiceSettings } from "./settings";

type DeviceSelection = Pick<
  VoiceSettings,
  "inputDeviceId" | "outputDeviceId" | "videoDeviceId"
>;

export type VoiceDeviceSelectionPatch = Partial<DeviceSelection>;

export interface VoiceDeviceSnapshot {
  audioInputs: ReadonlySet<string>;
  audioOutputs: ReadonlySet<string>;
  videoInputs: ReadonlySet<string>;
}

export interface ChangedDeviceKinds {
  audioInput: boolean;
  audioOutput: boolean;
  videoInput: boolean;
}

/**
 * Turns the browser's flat device list into the three inventories Stellarr
 * routes independently. Synthetic `default` entries stay in the snapshot, since
 * they reveal that the operating system changed its route, but they are never
 * persisted as a concrete selection.
 */
export function snapshotVoiceDevices(
  devices: readonly MediaDeviceInfo[],
): VoiceDeviceSnapshot {
  const idsOf = (kind: MediaDeviceKind) =>
    new Set(devices.filter((device) => device.kind === kind).map((device) => device.deviceId));

  return {
    audioInputs: idsOf("audioinput"),
    audioOutputs: idsOf("audiooutput"),
    videoInputs: idsOf("videoinput"),
  };
}

/** Which setting selects from which inventory. */
const ROUTES = [
  { setting: "inputDeviceId", inventory: "audioInputs" },
  { setting: "outputDeviceId", inventory: "audioOutputs" },
  { setting: "videoDeviceId", inventory: "videoInputs" },
] as const;

/** A concrete choice that has vanished falls back to the operating-system route. */
export function disconnectedDeviceFallbacks(
  settings: DeviceSelection,
  previous: VoiceDeviceSnapshot,
  next: VoiceDeviceSnapshot,
): VoiceDeviceSelectionPatch {
  const patch: VoiceDeviceSelectionPatch = {};
  for (const { setting, inventory } of ROUTES) {
    const selected = settings[setting];
    if (selected !== null && previous[inventory].has(selected) && !next[inventory].has(selected)) {
      patch[setting] = null;
    }
  }
  return patch;
}

export function changedDeviceKinds(
  previous: VoiceDeviceSnapshot,
  next: VoiceDeviceSnapshot,
): ChangedDeviceKinds {
  const differs = (inventory: keyof VoiceDeviceSnapshot) =>
    !sameIds(previous[inventory], next[inventory]);

  return {
    audioInput: differs("audioInputs"),
    audioOutput: differs("audioOutputs"),
    videoInput: differs("videoInputs"),
  };
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * One debounced, race-safe `devicechange` subscription.
 *
 * Chromium commonly emits several events for one USB headset (input, output,
 * then labels). Only the newest enumeration is published, so an older, slower
 * read cannot restore a device that has already disappeared.
 */
export function watchVoiceDevices(
  onDevices: (devices: readonly MediaDeviceInfo[]) => void,
  debounceMs = 180,
): () => void {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.enumerateDevices) return () => undefined;

  let stopped = false;
  let latestRead = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const read = async () => {
    const thisRead = ++latestRead;
    try {
      const devices = await media.enumerateDevices();
      if (!stopped && thisRead === latestRead) onDevices(devices);
    } catch {
      // Permission changes and WebView teardown can reject enumeration. The
      // last known routes stand: an empty list would claim everything was
      // unplugged. A subscriber that throws must not break the next read.
    }
  };

  const onDeviceChange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void read(), debounceMs);
  };

  void read();
  media.addEventListener?.("devicechange", onDeviceChange);

  return () => {
    stopped = true;
    clearTimeout(debounce);
    media.removeEventListener?.("devicechange", onDeviceChange);
  };
}
