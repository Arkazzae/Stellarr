import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api/client";
import type {
  SoundboardPlayedEvent,
  SoundboardSnapshot,
  SoundboardSound,
} from "@/lib/api/types";
import type { RealtimeClient, RealtimeEventMap } from "@/lib/realtime/types";
import { DEFAULT_SETTINGS, type VoiceSettings } from "@/lib/voice/settings";

import { createSoundboardAdapter } from "./soundboard";

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeBufferSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = "running";
  currentTime = 5;
  destination = new FakeNode();
  sources: FakeBufferSource[] = [];
  setSinkId = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => {
    this.state = "closed";
  });
  decodeAudioData = vi.fn(async () => ({ duration: 2 }) as AudioBuffer);

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

class FakeRealtime {
  private readonly handlers = new Map<
    keyof RealtimeEventMap,
    Array<(payload: unknown) => void>
  >();

  on = vi.fn(
    <E extends keyof RealtimeEventMap>(
      event: E,
      handler: (payload: RealtimeEventMap[E]) => void,
    ) => {
      const list = this.handlers.get(event) ?? [];
      list.push(handler as (payload: unknown) => void);
      this.handlers.set(event, list);
      return () => {
        this.handlers.set(
          event,
          (this.handlers.get(event) ?? []).filter((item) => item !== handler),
        );
      };
    },
  );
  getRtcClock = vi.fn(async () => Date.now());
  playSoundboard = vi.fn(async () => undefined);

  emit<E extends keyof RealtimeEventMap>(
    event: E,
    payload: RealtimeEventMap[E],
  ): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

const SOUND: SoundboardSound = {
  id: "airhorn",
  name: "Airhorn",
  glyph: "📣",
  url: "/soundboard/airhorn.mp3",
  durationSeconds: 2,
  trimStartSeconds: 0,
  trimEndSeconds: 2,
};

function snapshot(sounds: SoundboardSound[] = []): SoundboardSnapshot {
  return {
    sounds,
    settings: { everyoneCanPlay: true, rateLimited: true },
    canManage: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function build(
  api: Pick<ApiClient, "getSoundboard">,
  realtime: FakeRealtime,
  settings: () => VoiceSettings = () => ({ ...DEFAULT_SETTINGS }),
) {
  return createSoundboardAdapter(
    api as ApiClient,
    realtime as unknown as RealtimeClient,
    settings,
  );
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("soundboard audio adapter", () => {
  it("routes back to the system default after a custom output was selected", async () => {
    let settings: VoiceSettings = {
      ...DEFAULT_SETTINGS,
      outputDeviceId: "headset",
    };
    const adapter = build(
      { getSoundboard: vi.fn(async () => snapshot()) },
      new FakeRealtime(),
      () => settings,
    );

    adapter.preparePlayback();
    const context = FakeAudioContext.instances[0]!;
    await vi.waitFor(() => expect(context.setSinkId).toHaveBeenCalledWith("headset"));

    settings = { ...settings, outputDeviceId: null };
    adapter.preparePlayback();
    await vi.waitFor(() => expect(context.setSinkId).toHaveBeenLastCalledWith(""));
    adapter.dispose();
  });

  it("reloads after a change event that arrives during an in-flight load", async () => {
    const first = deferred<SoundboardSnapshot>();
    const latest = { ...SOUND, name: "Latest" };
    const getSoundboard = vi
      .fn<() => Promise<SoundboardSnapshot>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(snapshot([latest]));
    const realtime = new FakeRealtime();
    const adapter = build({ getSoundboard }, realtime);

    const loading = adapter.load();
    realtime.emit("SoundboardChanged", { serverId: "server-1" });
    first.resolve(snapshot([SOUND]));
    await loading;

    expect(getSoundboard).toHaveBeenCalledTimes(2);
    expect(adapter.getSnapshot().sounds).toEqual([latest]);
    adapter.dispose();
  });

  it("does not resurrect an AudioContext when a preload finishes after disposal", async () => {
    const response = deferred<ArrayBuffer>();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: () => response.promise,
    } as Response);
    const adapter = build(
      { getSoundboard: vi.fn(async () => snapshot([SOUND])) },
      new FakeRealtime(),
    );

    await adapter.load();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    adapter.dispose();
    response.resolve(new ArrayBuffer(8));
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("clamps corrupt trim metadata to the decoded buffer duration", async () => {
    const realtime = new FakeRealtime();
    const adapter = build(
      { getSoundboard: vi.fn(async () => snapshot()) },
      realtime,
    );
    adapter.preparePlayback();
    const context = FakeAudioContext.instances[0]!;
    const event: SoundboardPlayedEvent = {
      playbackId: "play-1",
      channelId: "channel-1",
      triggeredByUserId: "user-1",
      startsAtUnixMs: Date.now(),
      sound: {
        ...SOUND,
        trimStartSeconds: -10,
        trimEndSeconds: 500,
      },
    };

    realtime.emit("SoundboardPlayed", event);
    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    await vi.waitFor(() => expect(context.sources[0]?.start).toHaveBeenCalled());

    const [, offset, remaining] = context.sources[0]?.start.mock.calls[0] ?? [];
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeGreaterThan(0);
    expect(Number(offset) + Number(remaining)).toBeCloseTo(2, 5);
    adapter.dispose();
  });

  it("plays an arrival sound without adopting it into the board", async () => {
    const realtime = new FakeRealtime();
    const adapter = build(
      { getSoundboard: vi.fn(async () => snapshot()) },
      realtime,
    );
    adapter.preparePlayback();
    const context = FakeAudioContext.instances[0]!;

    realtime.emit("JoinSoundPlayed", {
      playbackId: "join-1",
      channelId: "channel-1",
      triggeredByUserId: "user-9",
      startsAtUnixMs: Date.now(),
      // A greeting can come from a server this listener is not on, so it must
      // never end up among the tiles they can press.
      sound: { ...SOUND, id: "guest-sound" },
    });

    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    expect(adapter.getSnapshot().sounds).toHaveLength(0);
    // The chime asks once per arrival, and the answer is spent by the asking.
    expect(adapter.takeJoinAnnouncement("user-9")).toBe(true);
    expect(adapter.takeJoinAnnouncement("user-9")).toBe(false);
    expect(adapter.takeJoinAnnouncement("someone-else")).toBe(false);
    adapter.dispose();
  });

  it("drops an arrival sound for a listener who turned arrivals off", async () => {
    const realtime = new FakeRealtime();
    const adapter = build(
      { getSoundboard: vi.fn(async () => snapshot()) },
      realtime,
    );
    adapter.preparePlayback();
    const context = FakeAudioContext.instances[0]!;
    adapter.setArrivalsAudible(false);

    realtime.emit("JoinSoundPlayed", {
      playbackId: "join-2",
      channelId: "channel-1",
      triggeredByUserId: "user-9",
      startsAtUnixMs: Date.now(),
      sound: SOUND,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(context.sources).toHaveLength(0);
    // No mark either: the chime it would have silenced is off as well.
    expect(adapter.takeJoinAnnouncement("user-9")).toBe(false);
    adapter.dispose();
  });

  it("previews the chosen arrival window locally", async () => {
    const realtime = new FakeRealtime();
    const adapter = build(
      { getSoundboard: vi.fn(async () => snapshot()) },
      realtime,
    );

    await adapter.preview({ ...SOUND, trimStartSeconds: 0.5, trimEndSeconds: 1.5 });

    const context = FakeAudioContext.instances[0]!;
    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    const [, offset, remaining] = context.sources[0]?.start.mock.calls[0] ?? [];
    expect(Number(offset)).toBeCloseTo(0.5, 2);
    expect(Number(remaining)).toBeCloseTo(1, 2);
    // Nothing was announced: an audition is not somebody walking in.
    expect(realtime.playSoundboard).not.toHaveBeenCalled();
    adapter.dispose();
  });
});
