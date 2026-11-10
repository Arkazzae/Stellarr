import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/voice/settings";

import { useMicTest } from "./useMicTest";

const fakes = vi.hoisted(() => {
  const rawTrack = {
    kind: "audio",
    enabled: true,
    onended: null as ((event?: Event) => void) | null,
    stop: vi.fn(),
    getSettings: () => ({ deviceId: "mic-1" }),
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [rawTrack],
    getAudioTracks: () => [rawTrack],
  } as unknown as MediaStream;
  const dispose = vi.fn();
  return {
    rawTrack,
    stream,
    dispose,
    captureMicrophone: vi.fn(async () => ({
      track: rawTrack,
      rawTrack,
      stream,
      rnnoiseActive: false,
      noiseSuppression: "browser" as const,
      resume: async () => true,
      dispose,
    })),
    detectorDispose: vi.fn(),
  };
});

vi.mock("@/lib/voice/micPipeline", () => ({
  MicCaptureError: class MicCaptureError extends Error {},
  captureMicrophone: fakes.captureMicrophone,
  hasDeviceLabels: () => true,
  listInputDevices: async () => [
    { deviceId: "mic-1", label: "Microphone" } as MediaDeviceInfo,
  ],
}));

vi.mock("@/lib/voice/vad", () => ({
  SpeechDetector: class SpeechDetector {
    add = vi.fn(async () => true);
    dispose = fakes.detectorDispose;
    setSensitivity = vi.fn();
  },
}));

vi.mock("@/state/hooks", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  fakes.captureMicrophone.mockClear();
  fakes.dispose.mockClear();
  fakes.detectorDispose.mockClear();
  (fakes.rawTrack as MediaStreamTrack).onended = null;
});

describe("useMicTest", () => {
  it("stops and reports an error when the active input device disappears", async () => {
    const { result, unmount } = renderHook(() =>
      useMicTest({ ...DEFAULT_SETTINGS }),
    );

    act(() => result.current.start());
    await waitFor(() => expect(result.current.running).toBe(true));

    act(() => {
      const onended = (fakes.rawTrack as MediaStreamTrack).onended;
      (onended as unknown as () => void)();
    });

    expect(result.current.running).toBe(false);
    expect(result.current.activeNoiseSuppression).toBeNull();
    expect(result.current.error).toBe("voiceTest.micFailed");
    expect(fakes.dispose).toHaveBeenCalledOnce();
    unmount();
  });
});
