import { describe, expect, it, vi } from "vitest";

import type { VoiceDeviceSnapshot } from "./deviceMonitor";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { planDeviceChange, SettingsQueue, type SettingsChange } from "./webrtcSettings";

function change(settings: Partial<VoiceSettings> = {}, flags: Partial<SettingsChange> = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    recaptureMic: false,
    recaptureCamera: false,
    refreshPlayback: false,
    ...flags,
  };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe("SettingsQueue", () => {
  it("applies a change at once when nothing is running", async () => {
    const apply = vi.fn(async () => undefined);
    const queue = new SettingsQueue(apply, () => false);
    const first = change({ outputVolume: 40 });

    await queue.push(first);

    expect(apply).toHaveBeenCalledExactlyOnceWith(first);
    expect(queue.pending).toBeNull();
  });

  it("folds changes made meanwhile into one follow-up with the newest settings", async () => {
    const hold = gate();
    const applied: SettingsChange[] = [];
    const queue = new SettingsQueue(async (next) => {
      applied.push(next);
      if (applied.length === 1) await hold.opened;
    }, () => false);

    const running = queue.push(change({ outputVolume: 10 }));
    const second = queue.push(change({ outputVolume: 20 }));
    const third = queue.push(change({ outputVolume: 30 }));
    expect(queue.pending?.settings.outputVolume).toBe(30);
    hold.open();
    await Promise.all([running, second, third]);

    expect(applied.map((item) => item.settings.outputVolume)).toEqual([10, 30]);
  });

  it("remembers a request to reopen the microphone, camera or playback until it is applied", async () => {
    const hold = gate();
    const applied: SettingsChange[] = [];
    const queue = new SettingsQueue(async (next) => {
      applied.push(next);
      if (applied.length === 1) await hold.opened;
    }, () => false);

    const running = queue.push(change());
    void queue.push(change({}, { recaptureMic: true }));
    void queue.push(change({}, { recaptureCamera: true }));
    void queue.push(change({}, { refreshPlayback: true }));
    void queue.push(change());
    hold.open();
    await running;

    expect(applied[1]).toMatchObject({
      recaptureMic: true,
      recaptureCamera: true,
      refreshPlayback: true,
    });
  });

  it("does not carry a request over into the change after it", async () => {
    const applied: SettingsChange[] = [];
    const queue = new SettingsQueue(async (next) => {
      applied.push(next);
    }, () => false);

    await queue.push(change({}, { recaptureMic: true }));
    await queue.push(change());

    expect(applied.map((item) => item.recaptureMic)).toEqual([true, false]);
  });

  it("accepts a new change once the earlier ones are done", async () => {
    const apply = vi.fn(async () => undefined);
    const queue = new SettingsQueue(apply, () => false);

    await queue.push(change());
    await queue.push(change());

    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("keeps going after a change that failed", async () => {
    const apply = vi
      .fn<(next: SettingsChange) => Promise<void>>()
      .mockRejectedValueOnce(new Error("device"))
      .mockResolvedValue(undefined);
    const queue = new SettingsQueue(apply, () => false);

    await expect(queue.push(change())).rejects.toThrow("device");
    await queue.push(change());

    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("applies nothing once stopped", async () => {
    const apply = vi.fn(async () => undefined);
    const queue = new SettingsQueue(apply, () => true);

    await queue.push(change());

    expect(apply).not.toHaveBeenCalled();
    expect(queue.pending).toBeNull();
  });

  it("drops what is waiting when it is stopped mid-way", async () => {
    const hold = gate();
    let stopped = false;
    const apply = vi.fn(async () => {
      await hold.opened;
    });
    const queue = new SettingsQueue(apply, () => stopped);

    const running = queue.push(change());
    void queue.push(change());
    stopped = true;
    hold.open();
    await running;

    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe("planDeviceChange", () => {
  const snapshot = (
    inputs: string[],
    outputs: string[] = [],
    videos: string[] = [],
  ): VoiceDeviceSnapshot => ({
    audioInputs: new Set(inputs),
    audioOutputs: new Set(outputs),
    videoInputs: new Set(videos),
  });

  it("does nothing when no device came or went", () => {
    expect(
      planDeviceChange(DEFAULT_SETTINGS, snapshot(["a"], ["x"], ["cam"]), snapshot(["a"], ["x"], ["cam"])),
    ).toBeNull();
  });

  it("forgets a chosen microphone that disappeared and reopens on the system route", () => {
    const settings = { ...DEFAULT_SETTINGS, inputDeviceId: "usb" };

    const plan = planDeviceChange(settings, snapshot(["usb", "built-in"]), snapshot(["built-in"]));

    expect(plan?.persist).toEqual({ inputDeviceId: null });
    expect(plan?.change).toMatchObject({ recaptureMic: true, refreshPlayback: false });
    expect(plan?.change.settings.inputDeviceId).toBeNull();
  });

  it("forgets a chosen speaker that disappeared and moves playback", () => {
    const settings = { ...DEFAULT_SETTINGS, outputDeviceId: "usb" };

    const plan = planDeviceChange(settings, snapshot([], ["usb", "speakers"]), snapshot([], ["speakers"]));

    expect(plan?.persist).toEqual({ outputDeviceId: null });
    expect(plan?.change).toMatchObject({ recaptureMic: false, refreshPlayback: true });
  });

  it("reopens a system-default microphone when the list of microphones changed", () => {
    const plan = planDeviceChange(DEFAULT_SETTINGS, snapshot(["a"]), snapshot(["b"]));

    expect(plan?.persist).toEqual({});
    expect(plan?.change.recaptureMic).toBe(true);
  });

  it("leaves a microphone chosen by id alone when another one changes", () => {
    const settings = { ...DEFAULT_SETTINGS, inputDeviceId: "a" };

    const plan = planDeviceChange(settings, snapshot(["a"]), snapshot(["a", "b"]));

    expect(plan?.persist).toEqual({});
    expect(plan?.change.recaptureMic).toBe(false);
  });

  it("forgets a chosen camera that disappeared, even when no camera is on", () => {
    const settings = { ...DEFAULT_SETTINGS, videoDeviceId: "cam-1" };

    const plan = planDeviceChange(
      settings,
      snapshot(["a"], [], ["cam-1", "cam-2"]),
      snapshot(["a"], [], ["cam-2"]),
    );

    expect(plan?.persist).toEqual({ videoDeviceId: null });
    expect(plan?.change.settings.videoDeviceId).toBeNull();
    expect(plan?.change).toMatchObject({ recaptureMic: false, refreshPlayback: false });
  });

  it("reopens a system-default camera when the list of cameras changed", () => {
    const plan = planDeviceChange(
      DEFAULT_SETTINGS,
      snapshot(["a"], [], ["cam-1"]),
      snapshot(["a"], [], ["cam-2"]),
    );

    expect(plan?.persist).toEqual({});
    expect(plan?.change).toMatchObject({ recaptureCamera: true, recaptureMic: false });
  });

  it("reopens the camera on the system route when the chosen one vanished", () => {
    const settings = { ...DEFAULT_SETTINGS, videoDeviceId: "cam-1" };

    const plan = planDeviceChange(settings, snapshot([], [], ["cam-1"]), snapshot([], [], []));

    expect(plan?.change.recaptureCamera).toBe(true);
  });

  it("reports every vanished choice together", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      inputDeviceId: "usb",
      outputDeviceId: "usb-out",
      videoDeviceId: "cam-1",
    };

    const plan = planDeviceChange(
      settings,
      snapshot(["usb"], ["usb-out"], ["cam-1"]),
      snapshot([], [], []),
    );

    expect(plan?.persist).toEqual({
      inputDeviceId: null,
      outputDeviceId: null,
      videoDeviceId: null,
    });
    expect(plan?.change).toMatchObject({ recaptureMic: true, refreshPlayback: true });
  });

  it("leaves a camera chosen by id alone when another one is unplugged", () => {
    const settings = { ...DEFAULT_SETTINGS, videoDeviceId: "cam-1" };

    expect(
      planDeviceChange(
        settings,
        snapshot(["a"], [], ["cam-1", "cam-2"]),
        snapshot(["a"], [], ["cam-1"]),
      ),
    ).toBeNull();
  });
});
