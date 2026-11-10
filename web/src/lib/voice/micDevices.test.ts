import { afterEach, describe, expect, it, vi } from "vitest";

import { listInputDevices, listOutputDevices, listVideoDevices } from "./micDevices";

function device(kind: MediaDeviceKind, deviceId: string, label = "") {
  return { kind, deviceId, label } as MediaDeviceInfo;
}

function stubDevices(enumerateDevices: (() => Promise<MediaDeviceInfo[]>) | undefined) {
  vi.stubGlobal("navigator", { mediaDevices: enumerateDevices ? { enumerateDevices } : {} });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("device lists", () => {
  const all = [
    device("audioinput", "mic-1", "Headset"),
    device("audioinput", "mic-2"),
    device("audiooutput", "default", "Default"),
    device("audiooutput", "speakers", "Speakers"),
    device("videoinput", "cam-1", "Webcam"),
  ];

  it("returns only the requested kind", async () => {
    stubDevices(async () => all);

    expect((await listInputDevices()).map((entry) => entry.deviceId)).toEqual(["mic-1", "mic-2"]);
    expect((await listVideoDevices()).map((entry) => entry.deviceId)).toEqual(["cam-1"]);
  });

  it("leaves out the synthetic default output so the choice is not offered twice", async () => {
    stubDevices(async () => all);

    expect((await listOutputDevices()).map((entry) => entry.deviceId)).toEqual(["speakers"]);
  });

  it("is empty where the browser cannot enumerate", async () => {
    stubDevices(undefined);

    await expect(listInputDevices()).resolves.toEqual([]);
    await expect(listOutputDevices()).resolves.toEqual([]);
  });

  it("is empty rather than throwing when enumeration fails", async () => {
    stubDevices(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });

    await expect(listInputDevices()).resolves.toEqual([]);
  });
});
