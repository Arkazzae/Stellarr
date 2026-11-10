import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  playSystemFx,
  stopAllSystemFx,
} from "./systemFx";

interface FakeAudio {
  src: string;
  preload: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

const created: FakeAudio[] = [];

beforeEach(() => {
  stopAllSystemFx();
  created.length = 0;
  const AudioMock = vi.fn(function AudioMock(this: FakeAudio, src: string) {
    this.src = src;
    this.preload = "none";
    this.loop = false;
    this.volume = 1;
    this.currentTime = 12;
    this.play = vi.fn(() => Promise.resolve());
    this.pause = vi.fn();
    created.push(this);
  });
  vi.stubGlobal(
    "Audio",
    AudioMock,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("system FX", () => {
  it("caches one-shots and restarts them at their standard volume", () => {
    playSystemFx("mute");
    playSystemFx("mute");

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      src: "/sounds/mute.wav",
      preload: "auto",
      loop: false,
      volume: 0.5,
      currentTime: 0,
    });
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });

  it("clamps a caller volume multiplier", () => {
    playSystemFx("unmute", 4);
    expect(created[0]?.volume).toBe(1);
  });
});
