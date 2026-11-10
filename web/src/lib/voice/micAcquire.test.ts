import { describe, expect, it, vi } from "vitest";

import { openMicrophone } from "./micAcquire";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";

function track(options: { modes?: unknown[]; applied?: unknown } = {}) {
  return {
    kind: "audio",
    stop: vi.fn(),
    getCapabilities: () => ({ echoCancellation: options.modes ?? [true, false] }),
    getSettings: () => ({ echoCancellation: options.applied }),
  } as unknown as MediaStreamTrack;
}

function stream(...tracks: MediaStreamTrack[]): MediaStream {
  return { getTracks: () => tracks, getAudioTracks: () => tracks } as unknown as MediaStream;
}

function settings(patch: Partial<VoiceSettings> = {}): VoiceSettings {
  return { ...DEFAULT_SETTINGS, echoCancellation: true, ...patch };
}

describe("openMicrophone voice isolation", () => {
  it("keeps the original when the browser grants a different mode than asked", async () => {
    const original = track({ modes: [true, "all"] });
    const wrong = track({ applied: true });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(stream(original))
      .mockResolvedValueOnce(stream(wrong));

    const opened = await openMicrophone(settings(), getUserMedia);

    expect(opened.track).toBe(original);
    expect(wrong.stop).toHaveBeenCalledOnce();
    expect(original.stop).not.toHaveBeenCalled();
  });

  it("keeps the original when the isolated capture is refused", async () => {
    const original = track({ modes: [true, "all"] });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(stream(original))
      .mockRejectedValueOnce(new DOMException("no", "OverconstrainedError"));

    const opened = await openMicrophone(settings(), getUserMedia);

    expect(opened.track).toBe(original);
    expect(original.stop).not.toHaveBeenCalled();
  });

  it("tries the next mode when the strongest is refused", async () => {
    const original = track({ modes: [true, "remote-only", "all"] });
    const remoteOnly = track({ applied: "remote-only" });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(stream(original))
      .mockRejectedValueOnce(new DOMException("no", "OverconstrainedError"))
      .mockResolvedValueOnce(stream(remoteOnly));

    const opened = await openMicrophone(settings(), getUserMedia);

    expect(opened.track).toBe(remoteOnly);
    expect(original.stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: expect.objectContaining({ echoCancellation: { exact: "all" } }),
      video: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(3, {
      audio: expect.objectContaining({ echoCancellation: { exact: "remote-only" } }),
      video: false,
    });
  });

  it("trusts an accepted exact constraint when the browser does not report the mode", async () => {
    const original = track({ modes: [true, "all"] });
    const isolated = track({ applied: undefined });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(stream(original))
      .mockResolvedValueOnce(stream(isolated));

    const opened = await openMicrophone(settings(), getUserMedia);

    expect(opened.track).toBe(isolated);
  });

  it("does not stop a capture that comes back as the very same stream", async () => {
    const original = track({ modes: [true, "all"], applied: "all" });
    const same = stream(original);

    const opened = await openMicrophone(settings(), async () => same);

    expect(opened.stream).toBe(same);
    expect(original.stop).not.toHaveBeenCalled();
  });

  it("discards an isolated capture that has no audio track", async () => {
    const original = track({ modes: [true, "all"] });
    const empty = stream();
    const stopEmpty = vi.fn();
    Object.assign(empty, { getTracks: () => [{ stop: stopEmpty }] });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(stream(original))
      .mockResolvedValueOnce(empty);

    const opened = await openMicrophone(settings(), getUserMedia);

    expect(opened.track).toBe(original);
    expect(stopEmpty).toHaveBeenCalledOnce();
  });

  it("does not ask for isolation when the track cannot report capabilities", async () => {
    const original = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
    const getUserMedia = vi.fn().mockResolvedValue(stream(original));

    await openMicrophone(settings(), getUserMedia);

    expect(getUserMedia).toHaveBeenCalledOnce();
  });
});

describe("openMicrophone failures", () => {
  const fail = (name: string) => () => Promise.reject(new DOMException("x", name));

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "unavailable"],
    ["OverconstrainedError", "unavailable"],
    ["AbortError", "unavailable"],
  ])("maps %s to %s", async (name, kind) => {
    await expect(openMicrophone(settings(), fail(name))).rejects.toMatchObject({ kind });
  });

  it("treats an error that is not a DOMException by its name", async () => {
    const blocked = Object.assign(new Error("blocked"), { name: "NotAllowedError" });

    await expect(openMicrophone(settings(), () => Promise.reject(blocked))).rejects.toMatchObject({
      kind: "denied",
    });
  });

  it("treats a rejection with no name as an unavailable microphone", async () => {
    await expect(openMicrophone(settings(), () => Promise.reject(undefined))).rejects.toMatchObject(
      {
        kind: "unavailable",
      },
    );
  });

  it("stops the tracks of a stream that has no audio", async () => {
    const video = { stop: vi.fn() };
    const noAudio = {
      getTracks: () => [video],
      getAudioTracks: () => [],
    } as unknown as MediaStream;

    await expect(
      openMicrophone(settings({ echoCancellation: false }), async () => noAudio),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(video.stop).toHaveBeenCalledOnce();
  });
});
