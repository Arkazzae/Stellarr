import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api/client";
import type { SoundboardSnapshot, SoundboardSound } from "@/lib/api/types";
import type { RealtimeClient, RealtimeEventMap } from "@/lib/realtime/types";
import { translateMessage, type MessageKey } from "@/i18n";
import { DEFAULT_SETTINGS } from "@/lib/voice/settings";

import { createSoundboardAdapter } from "./soundboard";

const AIRHORN: SoundboardSound = {
  id: "airhorn",
  name: "Airhorn",
  glyph: "📣",
  url: "/soundboard/airhorn.mp3",
  durationSeconds: 2,
  trimStartSeconds: 0,
  trimEndSeconds: 2,
};

const DING: SoundboardSound = { ...AIRHORN, id: "ding", name: "Ding", glyph: "🔔" };

function snapshot(
  sounds: SoundboardSound[],
  rateLimited = true,
): SoundboardSnapshot {
  return {
    sounds,
    settings: { everyoneCanPlay: true, rateLimited },
    canManage: true,
  };
}

/** The failure the adapter reports, worded in Polish the way the interface shows it. */
function polishError(adapter: { getSnapshot(): { error: MessageKey | null } }): string | null {
  const { error } = adapter.getSnapshot();
  return error === null ? null : translateMessage("pl", error);
}

function fakeRealtime() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on: vi.fn(
      <E extends keyof RealtimeEventMap>(
        event: E,
        handler: (payload: RealtimeEventMap[E]) => void,
      ) => {
        const list = handlers.get(event) ?? [];
        list.push(handler as (payload: unknown) => void);
        handlers.set(event, list);
        return () => {
          handlers.set(
            event,
            (handlers.get(event) ?? []).filter((item) => item !== handler),
          );
        };
      },
    ),
    getRtcClock: vi.fn(async () => Date.now()),
    playSoundboard: vi.fn(async () => undefined),
    emit<E extends keyof RealtimeEventMap>(event: E, payload: RealtimeEventMap[E]) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
}

type FakeApi = {
  [K in
    | "getSoundboard"
    | "uploadAttachment"
    | "createSoundboardSound"
    | "updateSoundboardSound"
    | "deleteSoundboardSound"
    | "updateSoundboardSettings"]: ReturnType<typeof vi.fn>;
};

function build(api: Partial<FakeApi>, realtime = fakeRealtime()) {
  const adapter = createSoundboardAdapter(
    api as unknown as ApiClient,
    realtime as unknown as RealtimeClient,
    () => ({ ...DEFAULT_SETTINGS }),
  );
  return { adapter, realtime };
}

beforeEach(() => {
  // No clip is ever fetched for real: preloading fails quietly.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("soundboard loading", () => {
  it("publishes the server's board and clears the loading flag", async () => {
    const { adapter } = build({
      getSoundboard: vi.fn(async () => snapshot([AIRHORN])),
    });

    const pending = adapter.load();
    expect(adapter.getSnapshot().loading).toBe(true);
    await pending;

    expect(adapter.getSnapshot()).toMatchObject({
      sounds: [AIRHORN],
      canManage: true,
      loading: false,
      error: null,
    });
    adapter.dispose();
  });

  it("keeps the sounds it has and says so when a refresh fails", async () => {
    const getSoundboard = vi
      .fn<() => Promise<SoundboardSnapshot>>()
      .mockResolvedValueOnce(snapshot([AIRHORN]))
      .mockRejectedValueOnce(new Error("down"));
    const { adapter } = build({ getSoundboard });

    await adapter.load();
    await adapter.load();

    expect(adapter.getSnapshot().sounds).toEqual([AIRHORN]);
    expect(adapter.getSnapshot().loading).toBe(false);
    expect(adapter.getSnapshot().error).toBe("soundboard.loadFailed");
    expect(polishError(adapter)).toBe("Nie udało się pobrać dźwięków serwera.");
    adapter.dispose();
  });

  it("adds a sound it has not seen when somebody plays it", async () => {
    const { adapter, realtime } = build({
      getSoundboard: vi.fn(async () => snapshot([])),
    });
    await adapter.load();

    realtime.emit("SoundboardPlayed", {
      playbackId: "play-1",
      channelId: "channel-1",
      triggeredByUserId: "user-1",
      startsAtUnixMs: Date.now(),
      sound: DING,
    });

    expect(adapter.getSnapshot().sounds).toEqual([DING]);
    adapter.dispose();
  });
});

describe("soundboard playback requests", () => {
  async function loaded(rateLimited = true) {
    const built = build({
      getSoundboard: vi.fn(async () => snapshot([AIRHORN], rateLimited)),
    });
    await built.adapter.load();
    return built;
  }

  it("asks the server to play a known sound and refuses to repeat during the cooldown", async () => {
    vi.useFakeTimers();
    const { adapter, realtime } = await loaded();

    await adapter.play("airhorn", "channel-1");
    await adapter.play("airhorn", "channel-1");

    expect(realtime.playSoundboard).toHaveBeenCalledTimes(1);
    expect(realtime.playSoundboard).toHaveBeenCalledWith("channel-1", "airhorn");
    expect(adapter.cooldownRemaining()).toBe(5_000);

    const listener = vi.fn();
    adapter.subscribe(listener);
    vi.advanceTimersByTime(5_000);
    // The subscribers are told when the wait is over, so a button can unlock.
    expect(listener).toHaveBeenCalled();
    expect(adapter.cooldownRemaining()).toBe(0);

    await adapter.play("airhorn", "channel-1");
    expect(realtime.playSoundboard).toHaveBeenCalledTimes(2);
    adapter.dispose();
  });

  it("ignores a sound that is not on the board", async () => {
    const { adapter, realtime } = await loaded();

    await adapter.play("missing", "channel-1");

    expect(realtime.playSoundboard).not.toHaveBeenCalled();
    expect(adapter.cooldownRemaining()).toBe(0);
    adapter.dispose();
  });

  it("applies no cooldown when the server does not rate-limit", async () => {
    const { adapter, realtime } = await loaded(false);

    await adapter.play("airhorn", "channel-1");
    await adapter.play("airhorn", "channel-1");

    expect(realtime.playSoundboard).toHaveBeenCalledTimes(2);
    expect(adapter.cooldownRemaining()).toBe(0);
    adapter.dispose();
  });

  it("gives the cooldown back and reports it when the server refuses", async () => {
    const { adapter, realtime } = await loaded();
    realtime.playSoundboard.mockRejectedValueOnce(new Error("forbidden"));

    await adapter.play("airhorn", "channel-1");

    expect(adapter.cooldownRemaining()).toBe(0);
    expect(adapter.getSnapshot().error).toBe("soundboard.playRejected");
    expect(polishError(adapter)).toBe("Serwer odrzucił odtworzenie dźwięku.");
    await adapter.play("airhorn", "channel-1");
    expect(realtime.playSoundboard).toHaveBeenCalledTimes(2);
    adapter.dispose();
  });
});

describe("soundboard arrival announcements", () => {
  it("forgets an announcement once its window has passed", async () => {
    vi.useFakeTimers();
    const { adapter, realtime } = build({ getSoundboard: vi.fn(async () => snapshot([])) });

    realtime.emit("JoinSoundPlayed", {
      playbackId: "join-1",
      channelId: "channel-1",
      triggeredByUserId: "user-9",
      startsAtUnixMs: Date.now(),
      sound: DING,
    });
    vi.advanceTimersByTime(20_001);

    expect(adapter.takeJoinAnnouncement("user-9")).toBe(false);
    adapter.dispose();
  });
});

describe("soundboard management", () => {
  it("uploads the clip, creates the sound and adds it to the board", async () => {
    const uploadAttachment = vi.fn(async () => ({ id: "attachment-1" }));
    const createSoundboardSound = vi.fn(async () => DING);
    const { adapter } = build({
      getSoundboard: vi.fn(async () => snapshot([AIRHORN])),
      uploadAttachment,
      createSoundboardSound,
    });
    await adapter.load();
    const file = new File(["audio"], "ding.mp3", { type: "audio/mpeg" });

    const created = await adapter.create({
      file,
      name: "Ding",
      glyph: "🔔",
      durationSeconds: 1.5,
      trimStartSeconds: 0.25,
      trimEndSeconds: 1.25,
    });

    expect(uploadAttachment).toHaveBeenCalledWith(file, { durationSeconds: 1.5 });
    expect(createSoundboardSound).toHaveBeenCalledWith({
      attachmentId: "attachment-1",
      name: "Ding",
      glyph: "🔔",
      trimStartSeconds: 0.25,
      trimEndSeconds: 1.25,
    });
    expect(created).toEqual(DING);
    expect(adapter.getSnapshot().sounds).toEqual([AIRHORN, DING]);
    adapter.dispose();
  });

  it("replaces an edited sound in place and drops a deleted one", async () => {
    const renamed = { ...AIRHORN, name: "Foghorn" };
    const updateSoundboardSound = vi.fn(async () => renamed);
    const deleteSoundboardSound = vi.fn(async () => undefined);
    const { adapter } = build({
      getSoundboard: vi.fn(async () => snapshot([AIRHORN, DING])),
      updateSoundboardSound,
      deleteSoundboardSound,
    });
    await adapter.load();

    await adapter.update("airhorn", { name: "Foghorn" });
    expect(updateSoundboardSound).toHaveBeenCalledWith("airhorn", { name: "Foghorn" });
    expect(adapter.getSnapshot().sounds).toEqual([renamed, DING]);

    await adapter.delete("ding");
    expect(deleteSoundboardSound).toHaveBeenCalledWith("ding");
    expect(adapter.getSnapshot().sounds).toEqual([renamed]);
    adapter.dispose();
  });

  it("stores the rules the server returns", async () => {
    const rules = { everyoneCanPlay: false, rateLimited: false };
    const { adapter } = build({
      getSoundboard: vi.fn(async () => snapshot([])),
      updateSoundboardSettings: vi.fn(async () => rules),
    });
    await adapter.load();

    await adapter.updateSettings({ everyoneCanPlay: false, rateLimited: false });

    expect(adapter.getSnapshot().settings).toEqual(rules);
    adapter.dispose();
  });

  it("reports a rules update that failed and lets the caller see the error", async () => {
    const failure = new Error("denied");
    const { adapter } = build({
      getSoundboard: vi.fn(async () => snapshot([])),
      updateSoundboardSettings: vi.fn(async () => {
        throw failure;
      }),
    });
    await adapter.load();

    await expect(adapter.updateSettings({ rateLimited: false })).rejects.toBe(failure);

    expect(adapter.getSnapshot().settings.rateLimited).toBe(true);
    expect(adapter.getSnapshot().error).toBe("soundboard.rulesFailed");
    expect(polishError(adapter)).toBe("Nie udało się zapisać zasad soundboardu.");
    adapter.dispose();
  });
});

describe("soundboard subscriptions", () => {
  it("tells subscribers about changes until they leave or the adapter is disposed", async () => {
    const { adapter } = build({ getSoundboard: vi.fn(async () => snapshot([AIRHORN])) });
    const stays = vi.fn();
    const leaves = vi.fn();
    adapter.subscribe(stays);
    adapter.subscribe(leaves)();

    await adapter.load();
    expect(stays).toHaveBeenCalled();
    expect(leaves).not.toHaveBeenCalled();

    const calls = stays.mock.calls.length;
    adapter.dispose();
    await adapter.load();
    expect(stays).toHaveBeenCalledTimes(calls);
  });

  it("stops listening to the hub once disposed", async () => {
    const getSoundboard = vi.fn(async () => snapshot([]));
    const { adapter, realtime } = build({ getSoundboard });
    adapter.dispose();

    realtime.emit("SoundboardChanged", { serverId: "server-1" });

    expect(getSoundboard).not.toHaveBeenCalled();
  });
});
