import { afterEach, describe, expect, it, vi } from "vitest";

import { cameraIsSupported } from "./camera";

describe("camera support", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("needs a browser that can open media devices", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
    expect(cameraIsSupported()).toBe(true);

    vi.stubGlobal("navigator", { mediaDevices: undefined });
    expect(cameraIsSupported()).toBe(false);
  });
});
