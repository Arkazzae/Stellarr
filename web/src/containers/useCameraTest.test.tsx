import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, type VoiceSettings } from "@/lib/voice/settings";

import { useCameraTest } from "./useCameraTest";

vi.mock("@/state/hooks", () => {
  const t = (key: string) => key;
  return { useLanguage: () => ({ t }) };
});

function fakeStream() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

let getUserMedia: ReturnType<typeof vi.fn>;
const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

function installMediaDevices(devices: Partial<MediaDevices>) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: devices,
    configurable: true,
  });
}

beforeEach(() => {
  getUserMedia = vi.fn();
  installMediaDevices({
    getUserMedia: getUserMedia as unknown as MediaDevices["getUserMedia"],
    enumerateDevices: async () => [],
  });
});

afterEach(() => {
  if (original) Object.defineProperty(navigator, "mediaDevices", original);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("useCameraTest", () => {
  it("shows the camera it opened, on the chosen device", async () => {
    const opened = fakeStream();
    getUserMedia.mockResolvedValue(opened.stream);
    const settings: VoiceSettings = { ...DEFAULT_SETTINGS, videoDeviceId: "cam-2" };
    const { result } = renderHook(() => useCameraTest(settings));

    act(() => result.current.start());
    expect(result.current.starting).toBe(true);
    await waitFor(() => expect(result.current.running).toBe(true));

    expect(result.current.stream).toBe(opened.stream);
    expect(result.current.starting).toBe(false);
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: false,
        video: expect.objectContaining({ deviceId: { exact: "cam-2" } }),
      }),
    );
  });

  it("stops every track when the preview is stopped", async () => {
    const opened = fakeStream();
    getUserMedia.mockResolvedValue(opened.stream);
    const { result } = renderHook(() => useCameraTest({ ...DEFAULT_SETTINGS }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.running).toBe(true));

    act(() => result.current.stop());

    expect(opened.track.stop).toHaveBeenCalledOnce();
    expect(result.current.running).toBe(false);
    expect(result.current.stream).toBeNull();
  });

  it("stops every track when the pane unmounts", async () => {
    const opened = fakeStream();
    getUserMedia.mockResolvedValue(opened.stream);
    const { result, unmount } = renderHook(() => useCameraTest({ ...DEFAULT_SETTINGS }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.running).toBe(true));

    unmount();

    expect(opened.track.stop).toHaveBeenCalledOnce();
  });

  it("stops every track when the tab is hidden", async () => {
    const opened = fakeStream();
    getUserMedia.mockResolvedValue(opened.stream);
    const { result } = renderHook(() => useCameraTest({ ...DEFAULT_SETTINGS }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.running).toBe(true));

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    hidden.mockRestore();

    expect(opened.track.stop).toHaveBeenCalledOnce();
    expect(result.current.running).toBe(false);
  });

  it("discards a camera that opens after the preview was stopped", async () => {
    const late = fakeStream();
    let resolve: (stream: MediaStream) => void = () => undefined;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useCameraTest({ ...DEFAULT_SETTINGS }));
    act(() => result.current.start());

    act(() => result.current.stop());
    await act(async () => resolve(late.stream));

    expect(late.track.stop).toHaveBeenCalledOnce();
    expect(result.current.running).toBe(false);
    expect(result.current.starting).toBe(false);
  });

  it("swaps the preview when another camera is chosen", async () => {
    const first = fakeStream();
    const second = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const { result, rerender } = renderHook(
      ({ settings }: { settings: VoiceSettings }) => useCameraTest(settings),
      { initialProps: { settings: { ...DEFAULT_SETTINGS, videoDeviceId: "cam-1" } } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stream).toBe(first.stream));

    rerender({ settings: { ...DEFAULT_SETTINGS, videoDeviceId: "cam-2" } });

    await waitFor(() => expect(result.current.stream).toBe(second.stream));
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: "cam-2" } }),
      }),
    );
  });

  it.each([
    ["NotAllowedError", "voiceTest.cameraDenied"],
    ["NotFoundError", "voiceTest.cameraMissing"],
    ["NotSupportedError", "voiceTest.cameraUnsupported"],
    ["AbortError", "voiceTest.cameraFailed"],
  ])("explains a %s", async (name, message) => {
    getUserMedia.mockRejectedValue(new DOMException("refused", name));
    const { result } = renderHook(() => useCameraTest({ ...DEFAULT_SETTINGS }));

    act(() => result.current.start());

    await waitFor(() => expect(result.current.error).toBe(message));
    expect(result.current.starting).toBe(false);
    expect(result.current.running).toBe(false);
  });

  it("reports an unsupported browser when there is no media API", async () => {
    installMediaDevices({});
    const { result } = renderHook(() => useCameraTest({ ...DEFAULT_SETTINGS }));

    act(() => result.current.start());

    await waitFor(() =>
      expect(result.current.error).toBe("voiceTest.cameraUnsupported"),
    );
  });
});
