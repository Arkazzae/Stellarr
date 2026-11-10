import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { constructed, trigger } = vi.hoisted(() => ({
  constructed: vi.fn(),
  trigger: vi.fn<(cue: string) => Promise<void>>(),
}));

vi.mock("web-haptics", () => ({
  WebHaptics: class {
    constructor() {
      constructed();
    }
    trigger = trigger;
  },
}));

beforeEach(() => {
  // The instance is module state, so every test starts from a fresh module.
  vi.resetModules();
  constructed.mockClear();
  trigger.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("triggerHaptic", () => {
  it("creates nothing until the first cue", async () => {
    await import("./haptics");

    expect(constructed).not.toHaveBeenCalled();
  });

  it("plays the cue on one instance shared by every call", async () => {
    const { triggerHaptic } = await import("./haptics");

    triggerHaptic("selection");
    triggerHaptic("light");

    expect(constructed).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls).toEqual([["selection"], ["light"]]);
  });

  it("swallows a pattern the device rejects", async () => {
    // Vitest fails the run on an unhandled rejection, so reaching the end of
    // the test is the assertion.
    trigger.mockRejectedValue(new Error("vibration blocked"));
    const { triggerHaptic } = await import("./haptics");

    expect(() => triggerHaptic("light")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trigger).toHaveBeenCalledWith("light");
  });

  it("stays inert on the server", async () => {
    const { triggerHaptic } = await import("./haptics");
    vi.stubGlobal("window", undefined);

    triggerHaptic("light");

    expect(constructed).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});
