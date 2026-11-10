import { describe, expect, it, vi } from "vitest";
import {
  SCREEN_MAX_BITRATE,
  SCREEN_MAX_FRAMERATE,
  SCREEN_MAX_HEIGHT,
  SCREEN_SHARE_PROFILES,
  ScreenShareError,
  captureScreen,
  classifyScreenError,
  displayMediaConstraints,
  screenEncoding,
} from "./screenShare";

function track(kind: "video" | "audio"): MediaStreamTrack {
  return {
    kind,
    contentHint: "",
    stop: vi.fn(),
    getSettings: () => ({}),
  } as unknown as MediaStreamTrack;
}

function stream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: "screen-stream",
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

describe("displayMediaConstraints", () => {
  it("asks Chromium for system audio and a stable picker", () => {
    const constraints = displayMediaConstraints();
    // Without systemAudio the tab/system sound checkbox never appears.
    expect(constraints.systemAudio).toBe("include");
    expect(constraints.surfaceSwitching).toBe("include");
    // Otherwise the picker offers this very tab — an infinite hall of mirrors.
    expect(constraints.selfBrowserSurface).toBe("exclude");
  });

  it("caps resolution and frame rate rather than demanding them", () => {
    const video = displayMediaConstraints().video as MediaTrackConstraints;
    expect(video.height).toEqual({ max: SCREEN_MAX_HEIGHT });
    expect(video.frameRate).toEqual({ max: SCREEN_MAX_FRAMERATE });
  });

  it("maps every quality preset to capture constraints", () => {
    const economy = displayMediaConstraints("economy").video as MediaTrackConstraints;
    const sharp = displayMediaConstraints("sharp").video as MediaTrackConstraints;
    const ultra = displayMediaConstraints("ultra").video as MediaTrackConstraints;

    expect(economy).toMatchObject({ height: { max: 720 }, frameRate: { max: 15 } });
    expect(sharp).toMatchObject({ height: { max: 1440 }, frameRate: { max: 30 } });
    expect(ultra).toMatchObject({ height: { max: 2160 }, frameRate: { max: 60 } });
  });

  it("does not run speech processing over shared audio", () => {
    const audio = displayMediaConstraints().audio as MediaTrackConstraints;
    expect(audio.echoCancellation).toBe(false);
    expect(audio.noiseSuppression).toBe(false);
    expect(audio.autoGainControl).toBe(false);
  });
});

describe("captureScreen", () => {
  it("returns the video track and hints it as detail", async () => {
    const video = track("video");
    const capture = await captureScreen(async () => stream([video]));

    expect(capture.video).toBe(video);
    // Desktop content is text and edges, not motion.
    expect(video.contentHint).toBe("detail");
    expect(capture.audio).toBeNull();
  });

  it("picks up system audio when the picker granted it", async () => {
    const video = track("video");
    const audio = track("audio");
    const capture = await captureScreen(async () => stream([video, audio]));

    expect(capture.audio).toBe(audio);
    expect(audio.contentHint).toBe("music");
  });

  it("passes the selected profile into the system picker", async () => {
    const video = track("video");
    const getDisplayMedia = vi.fn(async () => stream([video]));

    await captureScreen(getDisplayMedia, "sharp");

    expect(getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ height: { max: 1440 } }),
      }),
    );
  });

  it("reports an unsupported browser rather than throwing raw", async () => {
    await expect(captureScreen(null)).rejects.toBeInstanceOf(ScreenShareError);
    await expect(captureScreen(null)).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("stops the stream and reports when no video track arrives", async () => {
    const audio = track("audio");
    const only = stream([audio]);
    await expect(captureScreen(async () => only)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(audio.stop).toHaveBeenCalled();
  });
});

describe("classifyScreenError", () => {
  it("separates cancelling the picker from being blocked", () => {
    // Telling someone "blocked" when they pressed Escape is simply wrong.
    const cancelled = classifyScreenError(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    expect(cancelled.kind).toBe("cancelled");

    const blocked = classifyScreenError(
      new DOMException("Permission denied by system", "NotAllowedError"),
    );
    expect(blocked.kind).toBe("denied");
  });

  it("maps hardware and support failures to their own kinds", () => {
    expect(classifyScreenError(new DOMException("x", "NotReadableError")).kind).toBe(
      "unavailable",
    );
    expect(classifyScreenError(new DOMException("x", "NotSupportedError")).kind).toBe(
      "unsupported",
    );
  });

  it("always produces a Polish message a person can act on", () => {
    for (const name of ["NotAllowedError", "NotReadableError", "NotSupportedError"]) {
      const error = classifyScreenError(new DOMException("x", name));
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).toMatch(/[ąćęłńóśźż]|ekran/i);
    }
  });

  it("has a fallback for anything unrecognised", () => {
    expect(classifyScreenError(new Error("weird")).kind).toBe("unavailable");
    expect(classifyScreenError(null).kind).toBe("unavailable");
  });
});

describe("screenEncoding", () => {
  it("caps at roughly 2.5 Mbps and 30 fps", () => {
    const encoding = screenEncoding();
    expect(encoding.maxBitrate).toBe(SCREEN_MAX_BITRATE);
    expect(SCREEN_MAX_BITRATE).toBe(2_500_000);
    expect(encoding.maxFramerate).toBe(30);
  });

  it("does not scale resolution down by default", () => {
    // Readability of shared text beats frame smoothness.
    expect(screenEncoding().scaleResolutionDownBy).toBe(1);
  });

  it("uses temporal layers and lets video yield to voice", () => {
    expect(screenEncoding("balanced")).toMatchObject({
      scalabilityMode: "L1T2",
      priority: "medium",
      networkPriority: "medium",
    });
    expect(screenEncoding("ultra")).toMatchObject({
      maxBitrate: SCREEN_SHARE_PROFILES.ultra.maxBitrate,
      maxFramerate: 60,
      scalabilityMode: "L1T3",
    });
  });
});
