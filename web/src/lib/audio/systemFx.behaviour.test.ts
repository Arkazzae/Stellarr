import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeAudio {
  src: string;
  preload: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

let created: FakeAudio[] = [];
let playResult: () => Promise<void> = () => Promise.resolve();

// The clips are cached in the module, so each test loads a fresh copy of it.
async function loadFx() {
  vi.resetModules();
  return await import("./systemFx");
}

beforeEach(() => {
  created = [];
  playResult = () => Promise.resolve();
  vi.stubGlobal(
    "Audio",
    vi.fn(function AudioMock(this: FakeAudio, src: string) {
      this.src = src;
      this.preload = "none";
      this.loop = false;
      this.volume = 1;
      this.currentTime = 9;
      this.play = vi.fn(() => playResult());
      this.pause = vi.fn();
      created.push(this);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the clips", () => {
  it("are all shipped with the app", async () => {
    const { SYSTEM_FX } = await loadFx();

    for (const { src } of Object.values(SYSTEM_FX)) {
      // Vitest runs from the web project's root, which holds `public/`.
      expect(existsSync(join(process.cwd(), "public", src))).toBe(true);
    }
  });

  it("loop only for the ringing call", async () => {
    const { SYSTEM_FX, playSystemFx } = await loadFx();
    const names = Object.keys(SYSTEM_FX) as (keyof typeof SYSTEM_FX)[];

    for (const name of names) playSystemFx(name);

    expect(created).toHaveLength(names.length);
    expect(created.filter((clip) => clip.loop).map((clip) => clip.src)).toEqual([
      "/sounds/calling.wav",
    ]);
  });
});

describe("volume", () => {
  it("scales the clip's own volume by the caller's multiplier", async () => {
    const { playSystemFx } = await loadFx();

    playSystemFx("calling", 0.5);

    expect(created[0]?.volume).toBeCloseTo(0.36);
  });

  it("never goes below silence", async () => {
    const { playSystemFx } = await loadFx();

    playSystemFx("join", -3);

    expect(created[0]?.volume).toBe(0);
  });
});

describe("a browser that refuses to play", () => {
  it("does not leak a rejected play() as an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { playSystemFx } = await loadFx();
    // A plain function: a spy would record the promise and so handle it.
    vi.stubGlobal(
      "Audio",
      function PlainAudio(this: { play: () => Promise<never> }) {
        this.play = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
      },
    );

    expect(() => playSystemFx("notification")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("does not throw when play() fails at once", async () => {
    const { playSystemFx } = await loadFx();
    playResult = () => {
      throw new DOMException("blocked", "NotSupportedError");
    };

    expect(() => playSystemFx("notification")).not.toThrow();
  });

  it("does not throw when the document cannot create audio, and tries again later", async () => {
    const { playSystemFx } = await loadFx();
    const Audio = vi.fn(() => {
      throw new Error("media is disabled");
    });
    vi.stubGlobal("Audio", Audio);

    expect(() => playSystemFx("mute")).not.toThrow();
    expect(() => playSystemFx("mute")).not.toThrow();

    expect(Audio).toHaveBeenCalledTimes(2);
  });

  it("lets a ringing call start again after the browser refused it", async () => {
    const { playSystemFx } = await loadFx();
    playResult = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    playSystemFx("calling");
    await new Promise((resolve) => setTimeout(resolve, 0));

    playResult = () => Promise.resolve();
    playSystemFx("calling");

    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });
});

describe("a ringing call", () => {
  it("starts once however often it is requested", async () => {
    const { playSystemFx } = await loadFx();

    playSystemFx("calling");
    playSystemFx("calling");

    expect(created).toHaveLength(1);
    expect(created[0]?.play).toHaveBeenCalledOnce();
  });

  it("stops, rewinds and can be started again", async () => {
    const { playSystemFx, stopSystemFx } = await loadFx();
    playSystemFx("calling");
    (created[0] as FakeAudio).currentTime = 4;

    stopSystemFx("calling");

    expect(created[0]?.pause).toHaveBeenCalledOnce();
    expect(created[0]?.currentTime).toBe(0);

    playSystemFx("calling");
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });

  it("is stopped together with every other clip when the shell is torn down", async () => {
    const { playSystemFx, stopAllSystemFx } = await loadFx();
    playSystemFx("calling");
    playSystemFx("stream");

    stopAllSystemFx();

    expect(created.map((clip) => clip.pause.mock.calls.length)).toEqual([1, 1]);
    playSystemFx("calling");
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });
});

describe("stopping", () => {
  it("is safe for a clip that never played", async () => {
    const { stopSystemFx, stopAllSystemFx } = await loadFx();

    expect(() => stopSystemFx("calling")).not.toThrow();
    expect(() => stopAllSystemFx()).not.toThrow();
    expect(created).toHaveLength(0);
  });

  it("does not throw when the browser refuses to pause", async () => {
    const { playSystemFx, stopSystemFx } = await loadFx();
    playSystemFx("calling");
    created[0]?.pause.mockImplementation(() => {
      throw new Error("detached");
    });

    expect(() => stopSystemFx("calling")).not.toThrow();
    playSystemFx("calling");
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });
});
