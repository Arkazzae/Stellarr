import { afterEach, describe, expect, it, vi } from "vitest";

import { setAndroidCallActive } from "./androidCallService";

describe("Android call foreground service bridge", () => {
  afterEach(() => {
    delete window.StellarrAndroidCall;
  });

  it("forwards active call state when the Android bridge exists", () => {
    const setActive = vi.fn();
    window.StellarrAndroidCall = { setActive };

    setAndroidCallActive(true);
    setAndroidCallActive(false);

    expect(setActive).toHaveBeenNthCalledWith(1, true);
    expect(setActive).toHaveBeenNthCalledWith(2, false);
  });

  it("keeps browser calls working without a native bridge", () => {
    expect(() => setAndroidCallActive(true)).not.toThrow();
  });
});
