import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAudioOutput, audioOutputSelectionSupported } from "./playback";

type SinkId = (id: string) => Promise<void>;

/** jsdom has no `setSinkId`; install one on the prototype for a test. */
function supportSinkSelection(setSinkId: SinkId): void {
  Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
    value: setSinkId,
    configurable: true,
    writable: true,
  });
}

function audioElement(): HTMLAudioElement {
  return document.createElement("audio");
}

afterEach(() => {
  Reflect.deleteProperty(HTMLMediaElement.prototype, "setSinkId");
});

describe("audioOutputSelectionSupported", () => {
  it("is false where the browser cannot route a media element", () => {
    expect(audioOutputSelectionSupported()).toBe(false);
  });

  it("is true once the browser offers setSinkId", () => {
    supportSinkSelection(async () => undefined);
    expect(audioOutputSelectionSupported()).toBe(true);
  });
});

describe("applyAudioOutput without setSinkId", () => {
  it("still sets the volume, as a fraction of 100", async () => {
    const element = audioElement();

    await applyAudioOutput(element, { outputDeviceId: null, outputVolume: 40 });

    expect(element.volume).toBeCloseTo(0.4);
  });

  it("clamps the volume into the range an element accepts", async () => {
    const element = audioElement();

    await applyAudioOutput(element, { outputDeviceId: null, outputVolume: 250 });
    expect(element.volume).toBe(1);

    await applyAudioOutput(element, { outputDeviceId: null, outputVolume: -5 });
    expect(element.volume).toBe(0);
  });

  it("resolves when the system default output is wanted", async () => {
    await expect(
      applyAudioOutput(audioElement(), { outputDeviceId: null, outputVolume: 100 }),
    ).resolves.toBeUndefined();
  });

  it("rejects a chosen speaker with NotSupportedError, after applying the volume", async () => {
    const element = audioElement();

    await expect(
      applyAudioOutput(element, { outputDeviceId: "usb-headphones", outputVolume: 30 }),
    ).rejects.toMatchObject({ name: "NotSupportedError" });
    expect(element.volume).toBeCloseTo(0.3);
  });
});

describe("applyAudioOutput with setSinkId", () => {
  it("routes the element to the chosen device", async () => {
    const setSinkId = vi.fn<SinkId>(async () => undefined);
    supportSinkSelection(setSinkId);

    await applyAudioOutput(audioElement(), { outputDeviceId: "usb-headphones", outputVolume: 100 });

    expect(setSinkId).toHaveBeenCalledExactlyOnceWith("usb-headphones");
  });

  it("asks for the default device with an empty id when none is chosen", async () => {
    const setSinkId = vi.fn<SinkId>(async () => undefined);
    supportSinkSelection(setSinkId);

    await applyAudioOutput(audioElement(), { outputDeviceId: null, outputVolume: 100 });

    expect(setSinkId).toHaveBeenCalledExactlyOnceWith("");
  });

  it("surfaces a refusal by the browser, with the volume already applied", async () => {
    supportSinkSelection(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    const element = audioElement();

    await expect(
      applyAudioOutput(element, { outputDeviceId: "gone", outputVolume: 60 }),
    ).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(element.volume).toBeCloseTo(0.6);
  });
});
