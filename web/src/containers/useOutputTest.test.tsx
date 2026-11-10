import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  PLAYBACK_TUNING_PRESETS,
  type VoiceSettings,
} from "@/lib/voice/settings";

import { useOutputTest } from "./useOutputTest";

const mixer = vi.hoisted(() => ({
  attachElement: vi.fn<
    (
      id: string,
      source: HTMLMediaElement,
      output: HTMLAudioElement,
      volume: number,
    ) => boolean
  >(() => true),
  dispose: vi.fn(),
  remove: vi.fn(),
  resume: vi.fn(async () => true),
  setProfile: vi.fn(),
}));

const translate = vi.hoisted(() =>
  vi.fn((key: string) => key),
);

vi.mock("@/lib/voice/micPipeline", () => ({
  hasDeviceLabels: () => true,
  listOutputDevices: async () => [],
}));

vi.mock("@/lib/voice/remoteMixer", () => ({
  RemoteVoiceMixer: class {
    attachElement = mixer.attachElement;
    dispose = mixer.dispose;
    remove = mixer.remove;
    resume = mixer.resume;
    setProfile = mixer.setProfile;
  },
}));

vi.mock("@/state/hooks", () => ({
  useLanguage: () => ({ t: translate }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  for (const spy of Object.values(mixer)) spy.mockClear();
  translate.mockClear();
});

describe("useOutputTest", () => {
  it("loops the voice sample and retunes its live receiver strip", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const initial: VoiceSettings = { ...DEFAULT_SETTINGS };
    const { result, rerender, unmount } = renderHook(
      ({ settings }: { settings: VoiceSettings }) => useOutputTest(settings),
      { initialProps: { settings: initial } },
    );

    act(() => result.current.start());
    await waitFor(() => expect(result.current.playing).toBe(true));

    const [, source] = mixer.attachElement.mock.calls[0] ?? [];
    expect(source).toBeInstanceOf(HTMLAudioElement);
    if (source === undefined) throw new Error("Playback source was not attached");
    expect(source.src).toContain("/sounds/voice-playback-test.mp3");
    expect(source.loop).toBe(true);

    const broadcast: VoiceSettings = {
      ...initial,
      playbackProfile: "broadcast",
      playbackTuning: { ...PLAYBACK_TUNING_PRESETS.broadcast },
    };
    rerender({ settings: broadcast });

    await waitFor(() =>
      expect(mixer.setProfile).toHaveBeenLastCalledWith(
        "broadcast",
        PLAYBACK_TUNING_PRESETS.broadcast,
      ),
    );
    expect(result.current.playing).toBe(true);
    unmount();
  });

  it("falls back to a fresh raw element when the processing context stays suspended", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    mixer.resume.mockResolvedValueOnce(false);
    const { result, unmount } = renderHook(() =>
      useOutputTest({ ...DEFAULT_SETTINGS }),
    );

    act(() => result.current.start());
    await waitFor(() => expect(result.current.playing).toBe(true));

    const source = mixer.attachElement.mock.calls[0]?.[1];
    const fallback = play.mock.instances[0] as HTMLAudioElement | undefined;
    expect(mixer.remove).toHaveBeenCalledWith("settings-playback-preview");
    expect(play).toHaveBeenCalledOnce();
    expect(fallback).toBeInstanceOf(HTMLAudioElement);
    expect(fallback).not.toBe(source);
    expect(fallback?.src).toContain("/sounds/voice-playback-test.mp3");
    unmount();
  });
});
