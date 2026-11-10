import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchVoiceDevices } from "./deviceMonitor";

const DEBOUNCE = 180;

const known = new Map<string, MediaDeviceInfo>();

/** One object per id, so equality does not depend on a fresh `toJSON` each time. */
function device(deviceId: string): MediaDeviceInfo {
  const existing = known.get(deviceId);
  if (existing) return existing;
  const created: MediaDeviceInfo = {
    kind: "audioinput",
    deviceId,
    groupId: "group",
    label: deviceId,
    toJSON: () => ({}),
  };
  known.set(deviceId, created);
  return created;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A `navigator.mediaDevices` stand-in whose enumeration the test controls. */
function installMediaDevices(enumerateDevices: () => Promise<MediaDeviceInfo[]>) {
  const events = new EventTarget();
  const media = Object.assign(events, { enumerateDevices: vi.fn(enumerateDevices) });
  Object.defineProperty(navigator, "mediaDevices", { value: media, configurable: true });
  return {
    media,
    plug: () => events.dispatchEvent(new Event("devicechange")),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("watchVoiceDevices", () => {
  it("publishes the devices present at the start", async () => {
    installMediaDevices(async () => [device("mic-a")]);
    const onDevices = vi.fn();

    const stop = watchVoiceDevices(onDevices, DEBOUNCE);
    await vi.advanceTimersByTimeAsync(0);

    expect(onDevices).toHaveBeenCalledExactlyOnceWith([device("mic-a")]);
    stop();
  });

  it("collapses a burst of devicechange events into one enumeration", async () => {
    const { media, plug } = installMediaDevices(async () => []);
    const stop = watchVoiceDevices(vi.fn(), DEBOUNCE);
    await vi.advanceTimersByTimeAsync(0);
    expect(media.enumerateDevices).toHaveBeenCalledTimes(1);

    plug();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    plug();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    plug();
    expect(media.enumerateDevices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(media.enumerateDevices).toHaveBeenCalledTimes(2);
    stop();
  });

  it("discards an older enumeration that finishes after a newer one", async () => {
    const slow = deferred<MediaDeviceInfo[]>();
    const fast = deferred<MediaDeviceInfo[]>();
    const pending = [slow, fast];
    const { plug } = installMediaDevices(() => pending.shift()?.promise ?? Promise.resolve([]));
    const onDevices = vi.fn();
    const stop = watchVoiceDevices(onDevices, DEBOUNCE);

    plug();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fast.resolve([device("headset-removed")]);
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve([device("headset-still-listed")]);
    await vi.advanceTimersByTimeAsync(0);

    // Publishing the slow read last would resurrect a device that is gone.
    expect(onDevices).toHaveBeenCalledExactlyOnceWith([device("headset-removed")]);
    stop();
  });

  it("publishes nothing when enumeration is rejected, and recovers on the next change", async () => {
    const outcomes: Array<() => Promise<MediaDeviceInfo[]>> = [
      () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
      async () => [device("mic-b")],
    ];
    const { plug } = installMediaDevices(() => outcomes.shift()?.() ?? Promise.resolve([]));
    const onDevices = vi.fn();
    const stop = watchVoiceDevices(onDevices, DEBOUNCE);

    await vi.advanceTimersByTimeAsync(0);
    expect(onDevices).not.toHaveBeenCalled();

    plug();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(onDevices).toHaveBeenCalledExactlyOnceWith([device("mic-b")]);
    stop();
  });

  it("keeps watching after a subscriber throws", async () => {
    const { plug } = installMediaDevices(async () => [device("mic-a")]);
    const onDevices = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("subscriber failed");
      })
      .mockImplementation(() => undefined);
    const stop = watchVoiceDevices(onDevices, DEBOUNCE);
    await vi.advanceTimersByTimeAsync(0);

    plug();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(onDevices).toHaveBeenCalledTimes(2);
    stop();
  });

  it("goes quiet after stopping: no new reads, no late publication, no listener", async () => {
    const inFlight = deferred<MediaDeviceInfo[]>();
    const { media, plug } = installMediaDevices(() => inFlight.promise);
    const onDevices = vi.fn();
    const stop = watchVoiceDevices(onDevices, DEBOUNCE);

    plug();
    stop();
    inFlight.resolve([device("mic-a")]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    plug();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);

    expect(onDevices).not.toHaveBeenCalled();
    expect(media.enumerateDevices).toHaveBeenCalledTimes(1);
  });

  it("returns a harmless unsubscribe where the browser has no media devices", () => {
    const onDevices = vi.fn();

    const stop = watchVoiceDevices(onDevices, DEBOUNCE);

    expect(() => stop()).not.toThrow();
    expect(onDevices).not.toHaveBeenCalled();
  });
});
