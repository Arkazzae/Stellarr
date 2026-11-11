import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { polish } from "@/test/translators";

import { captureMicrophone, type MicCapture } from "./micPipeline";
import type * as MicPipeline from "./micPipeline";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { VoiceStateStore } from "./store";
import type { SpeechDetector } from "./vad";
import { LocalMicrophone } from "./webrtcMicrophone";
import type { Link } from "./webrtcPeer";

vi.mock("./micPipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof MicPipeline>()),
  captureMicrophone: vi.fn(),
}));

function fakeCapture(overrides: Partial<MicCapture> = {}): MicCapture {
  const raw = { enabled: true, contentHint: "", onended: null, stop: vi.fn() };
  return {
    track: raw,
    rawTrack: raw,
    stream: {},
    monitorStream: {},
    processed: false,
    noiseSuppression: "none",
    gateActive: false,
    autoGain: "none",
    setSensitivity: vi.fn(),
    setInputGain: vi.fn(),
    fadeIn: vi.fn(),
    resume: vi.fn(async () => true),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as MicCapture;
}

let store: VoiceStateStore;
let speech: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let onDeviceLost: Mock<() => void>;
let microphone: LocalMicrophone;
let peers: Map<string, Link>;
let applyEncoding: Mock<() => Promise<void>>;
let rebuildLink: Mock<(link: Link) => Promise<void>>;

beforeEach(() => {
  vi.mocked(captureMicrophone).mockReset();
  peers = new Map();
  store = new VoiceStateStore();
  speech = { add: vi.fn(async () => true), remove: vi.fn() };
  onDeviceLost = vi.fn<() => void>();
  applyEncoding = vi.fn(async () => undefined);
  rebuildLink = vi.fn(async () => undefined);
  microphone = new LocalMicrophone({
    translate: polish,
    selfUserId: "u-a",
    store,
    speech: speech as unknown as SpeechDetector,
    links: () => peers.values(),
    applyEncoding,
    rebuildLink,
    onDeviceLost,
  });
});

describe("LocalMicrophone", () => {
  it("starts sending a capture marked as speech, and listens to it before the gate", () => {
    const capture = fakeCapture();

    microphone.adopt(capture, DEFAULT_SETTINGS);

    expect(microphone.capture).toBe(capture);
    expect(capture.rawTrack.contentHint).toBe("speech");
    expect(speech.add).toHaveBeenCalledWith("u-a", capture.monitorStream, true);
  });

  it("opens a capture muted when the person is muted", () => {
    store.set({ muted: true });
    const processed = { enabled: true } as MediaStreamTrack;
    const capture = fakeCapture({ track: processed });

    microphone.adopt(capture, DEFAULT_SETTINGS);

    expect(capture.rawTrack.enabled).toBe(false);
    expect(processed.enabled).toBe(false);
  });

  it("mutes and unmutes both the device track and the processed one", () => {
    const processed = { enabled: true } as MediaStreamTrack;
    const capture = fakeCapture({ track: processed });
    microphone.adopt(capture, DEFAULT_SETTINGS);

    microphone.setMuted(true);
    expect([capture.rawTrack.enabled, processed.enabled]).toEqual([false, false]);

    microphone.setMuted(false);
    expect([capture.rawTrack.enabled, processed.enabled]).toEqual([true, true]);
  });

  it("reports what is really running rather than what was asked for", () => {
    const capture = fakeCapture({ noiseSuppression: "browser" });

    microphone.adopt(capture, { ...DEFAULT_SETTINGS, noiseSuppression: "gtcrn" });

    expect(store.getSnapshot().noiseSuppressionActive).toBe(false);
    expect(store.getSnapshot().degraded).toContain("GTCRN");

    microphone.adopt(
      fakeCapture({ noiseSuppression: "gtcrn", gateActive: true, autoGain: "worklet" }),
      { ...DEFAULT_SETTINGS, noiseSuppression: "gtcrn" },
    );
    expect(store.getSnapshot().noiseSuppressionActive).toBe(true);
    expect(store.getSnapshot().degraded).toBeNull();
  });

  it("tells its owner when the device ends under the call", () => {
    const capture = fakeCapture();
    microphone.adopt(capture, DEFAULT_SETTINGS);

    (capture.rawTrack.onended as unknown as () => void)();

    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("releases the device, the detector and the end handler", () => {
    const capture = fakeCapture();
    microphone.adopt(capture, DEFAULT_SETTINGS);

    microphone.release();

    expect(capture.dispose).toHaveBeenCalled();
    expect(capture.rawTrack.onended).toBeNull();
    expect(speech.remove).toHaveBeenCalledWith("u-a");
    expect(microphone.capture).toBeNull();
  });

  it("retunes the running capture without reopening it", () => {
    const capture = fakeCapture();
    microphone.adopt(capture, DEFAULT_SETTINGS);

    microphone.tune({ ...DEFAULT_SETTINGS, vadSensitivity: 80, inputGainDb: 6 });

    expect(capture.setSensitivity).toHaveBeenCalledWith(80);
    expect(capture.setInputGain).toHaveBeenCalledWith(6);
  });

  it("asks for a reopen only when a capture-affecting setting changed", () => {
    const settings: VoiceSettings = { ...DEFAULT_SETTINGS };
    expect(microphone.needsReopen(settings)).toBe(false);

    microphone.adopt(fakeCapture(), settings);

    expect(microphone.needsReopen({ ...settings, opusProfile: "studio" })).toBe(false);
    expect(microphone.needsReopen({ ...settings, inputDeviceId: "other" })).toBe(true);
  });

  it("is fine to resume when there is nothing to resume, or nothing processed", async () => {
    await expect(microphone.resume()).resolves.toBe(true);

    microphone.adopt(
      fakeCapture({ resume: vi.fn(async () => false), processed: false }),
      DEFAULT_SETTINGS,
    );
    await expect(microphone.resume()).resolves.toBe(true);
  });

  it("asks for a fresh capture when a processing graph stayed asleep", async () => {
    microphone.adopt(
      fakeCapture({ resume: vi.fn(async () => false), processed: true }),
      DEFAULT_SETTINGS,
    );

    await expect(microphone.resume()).resolves.toBe(false);
  });

  it("does nothing to replace a microphone that is not running", async () => {
    const superseded = vi.fn(() => false);

    const swapped = await microphone.replace(
      { ...DEFAULT_SETTINGS, inputDeviceId: "x" },
      true,
      superseded,
    );

    expect(swapped).toBe(false);
    expect(superseded).not.toHaveBeenCalled();
    expect(store.getSnapshot().error).toBeNull();
  });

  describe("replace", () => {
    const other: VoiceSettings = { ...DEFAULT_SETTINGS, inputDeviceId: "other" };

    function peerWithSender(): { sender: { replaceTrack: Mock } } {
      const sender = { replaceTrack: vi.fn(async () => undefined) };
      peers.set("u-z", { micSender: sender } as unknown as Link);
      return { sender };
    }

    it("moves the senders to the new capture and says it took over", async () => {
      const running = fakeCapture();
      const replacement = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      vi.mocked(captureMicrophone).mockResolvedValue(replacement);

      const swapped = await microphone.replace(other, false, () => false);

      expect(swapped).toBe(true);
      expect(sender.replaceTrack).toHaveBeenCalledWith(replacement.track);
      expect(microphone.capture).toBe(replacement);
      expect(running.dispose).toHaveBeenCalled();
      expect(store.getSnapshot().error).toBeNull();
    });

    it("keeps the running capture when the setting does not affect it", async () => {
      const running = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);

      const swapped = await microphone.replace(
        { ...DEFAULT_SETTINGS, opusProfile: "studio" },
        false,
        () => false,
      );

      expect(swapped).toBe(false);
      expect(captureMicrophone).not.toHaveBeenCalled();
      expect(microphone.capture).toBe(running);
    });

    it("keeps the running capture when the new device cannot be opened", async () => {
      const running = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      vi.mocked(captureMicrophone).mockRejectedValue(new DOMException("gone", "NotFoundError"));

      const swapped = await microphone.replace(other, false, () => false);

      expect(swapped).toBe(false);
      expect(microphone.capture).toBe(running);
      expect(store.getSnapshot().error).toMatchObject({ recoverable: true });
    });

    it("drops a capture that a newer request made stale", async () => {
      const running = fakeCapture();
      const stale = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      vi.mocked(captureMicrophone).mockResolvedValue(stale);

      const swapped = await microphone.replace(other, false, () => true);

      expect(swapped).toBe(false);
      expect(stale.dispose).toHaveBeenCalled();
      expect(sender.replaceTrack).not.toHaveBeenCalled();
      expect(microphone.capture).toBe(running);
    });

    it("keeps the running capture when a peer refuses the new one", async () => {
      const running = fakeCapture();
      const replacement = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      sender.replaceTrack.mockRejectedValueOnce(new Error("sender closed"));
      vi.mocked(captureMicrophone).mockResolvedValue(replacement);

      const swapped = await microphone.replace(other, false, () => false);

      expect(swapped).toBe(false);
      expect(replacement.dispose).toHaveBeenCalled();
      expect(microphone.capture).toBe(running);
      expect(store.getSnapshot().error).toMatchObject({ kind: "mic-unavailable" });
    });

    it("drops a capture when the call was left while its senders were moving", async () => {
      const running = fakeCapture();
      const late = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      vi.mocked(captureMicrophone).mockResolvedValue(late);
      // Leaving the call mid-move: the links go first, so the move succeeds
      // over an empty list while nobody is left to own the new capture.
      let left = false;
      sender.replaceTrack.mockImplementationOnce(async () => {
        peers.clear();
        microphone.release();
        left = true;
      });

      const swapped = await microphone.replace(other, false, () => left);

      expect(swapped).toBe(false);
      expect(late.dispose).toHaveBeenCalled();
      expect(sender.replaceTrack).toHaveBeenCalledOnce();
      expect(microphone.capture).toBeNull();
      expect(running.dispose).toHaveBeenCalled();
    });

    it("moves the senders back when a newer request waits after they were moved", async () => {
      const running = fakeCapture();
      const late = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      vi.mocked(captureMicrophone).mockResolvedValue(late);
      // A newer settings change waits in the queue exactly as the move ends.
      // Its own reopen may yet fail, so the senders must not be left on a
      // capture that dies here: they go back to the one that survives.
      let newerWaiting = false;
      sender.replaceTrack.mockImplementationOnce(async () => {
        newerWaiting = true;
      });

      const swapped = await microphone.replace(other, false, () => newerWaiting);

      expect(swapped).toBe(false);
      expect(sender.replaceTrack).toHaveBeenNthCalledWith(1, late.track);
      expect(sender.replaceTrack).toHaveBeenNthCalledWith(2, running.track);
      expect(late.dispose).toHaveBeenCalled();
      expect(microphone.capture).toBe(running);
      expect(running.dispose).not.toHaveBeenCalled();
      expect(store.getSnapshot().error).toBeNull();
    });

    it("leaves the new call's microphone alone when the old swap finishes after rejoining", async () => {
      const running = fakeCapture();
      const late = fakeCapture();
      const rejoined = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      peerWithSender();
      vi.mocked(captureMicrophone).mockResolvedValueOnce(late);
      let finishEncoding!: () => void;
      let enteredEncoding!: () => void;
      const encoding = new Promise<void>((resolve) => { finishEncoding = resolve; });
      const encodingStarted = new Promise<void>((resolve) => { enteredEncoding = resolve; });
      applyEncoding.mockImplementationOnce(() => {
        enteredEncoding();
        return encoding;
      });
      let left = false;
      const swapping = microphone.replace(other, false, () => left);
      await encodingStarted;

      left = true;
      peers.clear();
      microphone.release();
      microphone.adopt(rejoined, other);
      const { sender } = peerWithSender();
      finishEncoding();

      expect(await swapping).toBe(false);
      expect(sender.replaceTrack).not.toHaveBeenCalled();
      expect(rebuildLink).not.toHaveBeenCalled();
      expect(microphone.capture).toBe(rejoined);
      expect(rejoined.dispose).not.toHaveBeenCalled();
      expect(late.dispose).toHaveBeenCalledOnce();
      expect(store.getSnapshot().error).toBeNull();
    });

    it("does not roll back links created after the swap began", async () => {
      const running = fakeCapture();
      const late = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const original = peerWithSender();
      vi.mocked(captureMicrophone).mockResolvedValueOnce(late);
      let newerWaiting = false;
      const lateSender = { replaceTrack: vi.fn(async () => undefined) };
      original.sender.replaceTrack.mockImplementationOnce(async () => {
        peers.set("u-late", { micSender: lateSender } as unknown as Link);
        newerWaiting = true;
      });

      expect(await microphone.replace(other, false, () => newerWaiting)).toBe(false);

      expect(original.sender.replaceTrack).toHaveBeenNthCalledWith(2, running.track);
      expect(lateSender.replaceTrack).not.toHaveBeenCalled();
      expect(late.dispose).toHaveBeenCalledOnce();
    });

    it("stops a rollback if the call changes while restoring a sender", async () => {
      const running = fakeCapture();
      const late = fakeCapture();
      const rejoined = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      const second = { replaceTrack: vi.fn(async () => undefined) };
      const secondLink = { micSender: second } as unknown as Link;
      peers.set("u-y", secondLink);
      vi.mocked(captureMicrophone).mockResolvedValueOnce(late);
      let newerWaiting = false;
      sender.replaceTrack
        .mockImplementationOnce(async () => { newerWaiting = true; })
        .mockImplementationOnce(async () => {
          peers.clear();
          microphone.release();
          microphone.adopt(rejoined, other);
          throw new Error("old connection closed");
        });

      expect(await microphone.replace(other, false, () => newerWaiting)).toBe(false);

      expect(second.replaceTrack).toHaveBeenCalledOnce();
      expect(rebuildLink).not.toHaveBeenCalled();
      expect(microphone.capture).toBe(rejoined);
      expect(rejoined.dispose).not.toHaveBeenCalled();
      expect(late.dispose).toHaveBeenCalledOnce();
    });

    it("rebuilds a current link that refuses the rollback after a partial swap", async () => {
      const running = fakeCapture();
      const late = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      const movedLink = peers.get("u-z");
      sender.replaceTrack.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("no rollback"));
      const refused = { replaceTrack: vi.fn(async () => { throw new Error("no swap"); }) };
      peers.set("u-y", { micSender: refused } as unknown as Link);
      vi.mocked(captureMicrophone).mockResolvedValueOnce(late);

      expect(await microphone.replace(other, false, () => false)).toBe(false);

      expect(sender.replaceTrack).toHaveBeenNthCalledWith(2, running.track);
      expect(refused.replaceTrack).toHaveBeenCalledOnce();
      expect(rebuildLink).toHaveBeenCalledExactlyOnceWith(movedLink);
      expect(microphone.capture).toBe(running);
      expect(running.dispose).not.toHaveBeenCalled();
      expect(late.dispose).toHaveBeenCalledOnce();
    });

    it.each(["opening", "moving"])("does not report a late %s failure in the new call", async (stage) => {
      const running = fakeCapture();
      const late = fakeCapture();
      const rejoined = fakeCapture();
      microphone.adopt(running, DEFAULT_SETTINGS);
      const { sender } = peerWithSender();
      let left = false;
      const failAfterRejoining = async () => {
        left = true;
        peers.clear();
        microphone.release();
        microphone.adopt(rejoined, other);
        throw new Error("old call ended");
      };
      if (stage === "opening") {
        vi.mocked(captureMicrophone).mockImplementationOnce(failAfterRejoining);
      } else {
        vi.mocked(captureMicrophone).mockResolvedValueOnce(late);
        sender.replaceTrack.mockImplementationOnce(failAfterRejoining);
      }

      expect(await microphone.replace(other, false, () => left)).toBe(false);

      expect(microphone.capture).toBe(rejoined);
      expect(rejoined.dispose).not.toHaveBeenCalled();
      expect(store.getSnapshot().error).toBeNull();
      expect(rebuildLink).not.toHaveBeenCalled();
      if (stage === "moving") expect(late.dispose).toHaveBeenCalledOnce();
    });
  });
});
