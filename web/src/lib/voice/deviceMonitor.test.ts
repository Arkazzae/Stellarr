import { describe, expect, it } from "vitest";

import {
  changedDeviceKinds,
  disconnectedDeviceFallbacks,
  snapshotVoiceDevices,
} from "./deviceMonitor";
import { DEFAULT_SETTINGS } from "./settings";

function device(kind: MediaDeviceKind, deviceId: string): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    groupId: "group",
    label: deviceId,
    toJSON: () => ({}),
  };
}

describe("voice device monitoring", () => {
  it("falls every vanished concrete selection back to the system route", () => {
    const previous = snapshotVoiceDevices([
      device("audioinput", "usb-mic"),
      device("audiooutput", "usb-headphones"),
      device("videoinput", "usb-camera"),
    ]);
    const next = snapshotVoiceDevices([
      device("audioinput", "built-in-mic"),
      device("audiooutput", "built-in-speakers"),
      device("videoinput", "built-in-camera"),
    ]);
    const patch = disconnectedDeviceFallbacks(
      {
        ...DEFAULT_SETTINGS,
        inputDeviceId: "usb-mic",
        outputDeviceId: "usb-headphones",
        videoDeviceId: "usb-camera",
      },
      previous,
      next,
    );

    expect(patch).toEqual({
      inputDeviceId: null,
      outputDeviceId: null,
      videoDeviceId: null,
    });
  });

  it("preserves connected devices and system-default selections", () => {
    const devices = [
      device("audioinput", "usb-mic"),
      device("audiooutput", "usb-headphones"),
      device("videoinput", "usb-camera"),
    ];

    expect(
      disconnectedDeviceFallbacks(
        {
          ...DEFAULT_SETTINGS,
          inputDeviceId: "usb-mic",
          outputDeviceId: "usb-headphones",
          videoDeviceId: "usb-camera",
        },
        snapshotVoiceDevices(devices),
        snapshotVoiceDevices(devices),
      ),
    ).toEqual({});
    expect(
      disconnectedDeviceFallbacks(
        DEFAULT_SETTINGS,
        snapshotVoiceDevices([]),
        snapshotVoiceDevices([]),
      ),
    ).toEqual({});
  });

  it("reports which independent route changed", () => {
    const previous = snapshotVoiceDevices([
      device("audioinput", "mic-a"),
      device("audiooutput", "speakers"),
      device("videoinput", "camera"),
    ]);
    const next = snapshotVoiceDevices([
      device("audioinput", "mic-b"),
      device("audiooutput", "speakers"),
      device("videoinput", "camera"),
    ]);

    expect(changedDeviceKinds(previous, next)).toEqual({
      audioInput: true,
      audioOutput: false,
      videoInput: false,
    });
  });
});
