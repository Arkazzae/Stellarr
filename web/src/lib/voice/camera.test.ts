import { describe, expect, it, vi } from "vitest";

import {
  CAMERA_MAX_BITRATE,
  CAMERA_MAX_FRAMERATE,
  cameraConstraints,
  cameraEncoding,
  captureCamera,
} from "./camera";

function track(): MediaStreamTrack {
  return {
    kind: "video",
    contentHint: "",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function stream(video: MediaStreamTrack | null): MediaStream {
  return {
    id: "camera-stream",
    getTracks: () => (video ? [video] : []),
    getVideoTracks: () => (video ? [video] : []),
  } as unknown as MediaStream;
}

describe("camera capture", () => {
  it("opens the selected device as video-only HD capture", () => {
    expect(
      cameraConstraints({ videoDeviceId: "camera-2", cameraQuality: "balanced" }),
    ).toEqual({
      audio: false,
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 },
        deviceId: { exact: "camera-2" },
      },
    });
  });

  it("prefers the front-facing default camera without forcing one id", () => {
    expect(
      cameraConstraints({ videoDeviceId: null, cameraQuality: "balanced" }),
    ).toMatchObject({
      audio: false,
      video: { facingMode: "user" },
    });
  });

  it("returns a motion track and releases it on dispose", async () => {
    const video = track();
    const getUserMedia = vi.fn(async () => stream(video));

    const capture = await captureCamera(
      { videoDeviceId: null, cameraQuality: "balanced" },
      getUserMedia,
    );

    expect(capture.video).toBe(video);
    expect(video.contentHint).toBe("motion");
    capture.dispose();
    expect(video.stop).toHaveBeenCalledTimes(1);
  });

  it("maps denied permission to an actionable failure", async () => {
    await expect(
      captureCamera(
        { videoDeviceId: null, cameraQuality: "balanced" },
        async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      ),
    ).rejects.toMatchObject({ kind: "denied" });
  });

  it("rejects a stream without a video track and stops it", async () => {
    const empty = stream(null);
    const stop = vi.fn();
    Object.assign(empty, { getTracks: () => [{ stop }] });

    await expect(
      captureCamera(
        { videoDeviceId: null, cameraQuality: "balanced" },
        async () => empty,
      ),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(stop).toHaveBeenCalled();
  });

  it("applies bounded realtime encoding", () => {
    expect(cameraEncoding()).toMatchObject({
      maxBitrate: CAMERA_MAX_BITRATE,
      maxFramerate: CAMERA_MAX_FRAMERATE,
      networkPriority: "medium",
      priority: "medium",
    });
  });

  it("uses the selected camera profile for capture and sender limits", () => {
    expect(
      cameraConstraints({ videoDeviceId: null, cameraQuality: "sharp" }),
    ).toMatchObject({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    expect(cameraEncoding("sharp")).toMatchObject({
      maxBitrate: 3_000_000,
      maxFramerate: 30,
    });
  });
});
