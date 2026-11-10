import { afterEach, describe, expect, it, vi } from "vitest";
import { getAndroidCallBridge } from "./callBridge";

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.StellarrAndroidCall;
});

describe("getAndroidCallBridge", () => {
  it("is undefined in a plain browser", () => {
    expect(getAndroidCallBridge()).toBeUndefined();
  });

  it("returns the bridge the Android shell injected", () => {
    const bridge = { setActive: vi.fn() };
    window.StellarrAndroidCall = bridge;

    expect(getAndroidCallBridge()).toBe(bridge);
  });

  it("is undefined on the server, where there is no window", () => {
    vi.stubGlobal("window", undefined);

    expect(getAndroidCallBridge()).toBeUndefined();
  });
});
