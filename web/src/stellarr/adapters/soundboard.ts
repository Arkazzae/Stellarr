import type { ApiClient } from "@/lib/api/client";
import type { SoundboardPlayedEvent } from "@/lib/api/types";
import type { RealtimeClient } from "@/lib/realtime/types";
import type { VoiceSettings } from "@/lib/voice/settings";
import type {
  Sound,
  SoundboardLive,
  SoundboardPlay,
  SoundboardPort,
  SoundboardState,
} from "@/ports";

import { createSoundboardAudio } from "./soundboardAudio";

const COOLDOWN_MS = 5_000;

/**
 * How long an arrival announcement keeps the shared chime quiet.
 *
 * The hub sends it the moment somebody joins; the media layer confirms the
 * same arrival once the peer connection is up, which is later and by an amount
 * only the network knows. The window covers that gap and then forgets, so a
 * rejoin an hour later still gets its chime if the clip has since gone away.
 */
const ANNOUNCEMENT_WINDOW_MS = 20_000;

const INITIAL_STATE: SoundboardState = Object.freeze({
  sounds: [],
  settings: Object.freeze({ everyoneCanPlay: true, rateLimited: true }),
  canManage: false,
  canPlay: false,
  supported: true,
  loading: false,
  error: null,
});

export function createSoundboardAdapter(
  api: ApiClient,
  realtime: RealtimeClient,
  getSettings: () => VoiceSettings,
): SoundboardPort {
  const audio = createSoundboardAudio(getSettings);
  const listeners = new Set<() => void>();
  /** Who arrived with their own sound, and until when that stays true. */
  const announcements = new Map<string, number>();
  let state = INITIAL_STATE;
  let serverOffsetMs = 0;
  let readyAt = 0;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  /** The live store: plays under way and the cooldown in whole seconds. */
  const liveListeners = new Set<() => void>();
  let playing: readonly SoundboardPlay[] = [];
  const playTimers = new Set<ReturnType<typeof setTimeout>>();
  let cooldownSeconds = 0;
  let arrivalsAudible = true;
  let loading: Promise<void> | null = null;
  let reloadRequested = false;
  /** Orders still on their way to the server; a reload waits for them. */
  let ordersPending = 0;
  let disposed = false;

  const notify = (): void => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };

  const patchState = (change: Partial<SoundboardState>): void => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...change });
    notify();
  };

  const notifyLive = (): void => {
    if (disposed) return;
    for (const listener of liveListeners) listener();
  };

  const stopCooldownTimer = (): void => {
    if (cooldownTimer !== null) clearTimeout(cooldownTimer);
    cooldownTimer = null;
  };

  /**
   * Counts the cooldown down in whole seconds, waking once a second exactly
   * when the count drops, and ends it at zero.
   */
  const tickCooldown = (): void => {
    cooldownTimer = null;
    const left = readyAt - Date.now();
    const seconds = left > 0 ? Math.ceil(left / 1000) : 0;
    if (seconds === 0) readyAt = 0;
    if (seconds !== cooldownSeconds) {
      cooldownSeconds = seconds;
      notifyLive();
    }
    if (seconds > 0) cooldownTimer = setTimeout(tickCooldown, left - (seconds - 1) * 1000);
  };

  const endCooldown = (): void => {
    stopCooldownTimer();
    readyAt = 0;
    if (cooldownSeconds !== 0) {
      cooldownSeconds = 0;
      notifyLive();
    }
  };

  /** A clip pressed on the board starts in the room: kept from its arrival until its end. */
  const startPlay = (event: SoundboardPlayedEvent): void => {
    const startsAt = event.startsAtUnixMs - serverOffsetMs;
    const length = Math.max(0, event.sound.trimEndSeconds - event.sound.trimStartSeconds);
    const play: SoundboardPlay = {
      playbackId: event.playbackId,
      sound: event.sound,
      userId: event.triggeredByUserId,
      startsAt,
      endsAt: startsAt + (Number.isFinite(length) ? length : 0) * 1000,
    };
    const wait = play.endsAt - Date.now();
    if (wait <= 0) return;
    playing = [...playing, play];
    notifyLive();
    const timer = setTimeout(() => {
      playTimers.delete(timer);
      playing = playing.filter((item) => item !== play);
      notifyLive();
    }, wait);
    playTimers.add(timer);
  };

  const live: SoundboardLive = {
    subscribe(listener) {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
    playing: () => playing,
    cooldownSeconds: () => cooldownSeconds,
  };

  const syncClock = async (): Promise<void> => {
    try {
      const before = Date.now();
      const serverNow = await realtime.getRtcClock();
      serverOffsetMs = serverNow - (before + Date.now()) / 2;
    } catch {
      // Device clocks are usually NTP-synchronised, so zero is a usable
      // fallback; the 750 ms lead the server adds absorbs network jitter.
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const snapshot = await api.getSoundboard();
      if (disposed) return;
      patchState({ ...snapshot, supported: true, loading: false, error: null });
      audio.preload(snapshot.sounds);
      void syncClock();
    } catch {
      patchState({ loading: false, error: "soundboard.loadFailed" });
    }
  };

  /** One run serves every caller; a change that lands mid-run triggers one more fetch. */
  const load = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (loading !== null) return loading;
    patchState({ loading: true, error: null });
    loading = (async () => {
      do {
        reloadRequested = false;
        await refresh();
        if (reloadRequested) patchState({ loading: true, error: null });
      } while (reloadRequested && !disposed);
    })().finally(() => {
      loading = null;
    });
    return loading;
  };

  /** Adds a sound to the board, or swaps in its edited version. */
  const upsert = (sound: Sound): void => {
    const known = state.sounds.some((item) => item.id === sound.id);
    patchState({
      sounds: known
        ? state.sounds.map((item) => (item.id === sound.id ? sound : item))
        : [...state.sounds, sound],
      error: null,
    });
    audio.preload([sound]);
  };

  const unsubscribers = [
    realtime.on("SoundboardPlayed", (event) => {
      if (disposed) return;
      if (!state.sounds.some((sound) => sound.id === event.sound.id)) {
        patchState({ sounds: [...state.sounds, event.sound] });
      }
      startPlay(event);
      audio.schedule(event, serverOffsetMs).catch(() => {
        patchState({ error: "soundboard.playFailed" });
      });
    }),

    // An arrival sound belongs to no board this listener can open: it may come
    // from a server they are not on. It is played and forgotten, never added
    // to `state.sounds`.
    realtime.on("JoinSoundPlayed", (event) => {
      if (disposed || !arrivalsAudible) return;
      announcements.set(event.triggeredByUserId, Date.now() + ANNOUNCEMENT_WINDOW_MS);
      audio.schedule(event, serverOffsetMs).catch(() => {
        // The clip may have been deleted between the join and the fetch. A
        // banner about a sound nobody here chose would only be noise.
      });
    }),

    realtime.on("SoundboardChanged", () => {
      reloadRequested = true;
      // Each saved order announces itself. Fetched while a later one is still
      // on its way, the board would show the older order for a moment.
      if (ordersPending === 0) void load();
    }),
  ];

  return {
    getSnapshot: () => state,
    load,
    cooldownRemaining: () => Math.max(0, readyAt - Date.now()),
    live,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    preparePlayback() {
      audio.prepare();
      void syncClock();
    },

    setDeafened: (deafened) => audio.setDeafened(deafened),
    setVolume: (volume) => audio.setVolume(volume),

    setArrivalsAudible(audible) {
      arrivalsAudible = audible;
      if (!audible) announcements.clear();
    },

    takeJoinAnnouncement(userId) {
      const until = announcements.get(userId);
      announcements.delete(userId);
      return until !== undefined && until > Date.now();
    },

    async play(soundId, channelId) {
      if (Date.now() < readyAt || !state.sounds.some((sound) => sound.id === soundId)) {
        return;
      }
      audio.prepare();
      if (state.settings.rateLimited) {
        stopCooldownTimer();
        readyAt = Date.now() + COOLDOWN_MS;
        tickCooldown();
      }
      try {
        await realtime.playSoundboard(channelId, soundId);
      } catch {
        endCooldown();
        patchState({ error: "soundboard.playRejected" });
      }
    },

    async preview(sound) {
      audio.prepare();
      await audio.schedule(
        {
          playbackId: `preview:${sound.id}`,
          channelId: "",
          triggeredByUserId: "",
          startsAtUnixMs: Date.now(),
          sound,
        },
        0,
      );
    },

    async create(input) {
      const attachment = await api.uploadAttachment(input.file, {
        durationSeconds: input.durationSeconds,
      });
      const sound = await api.createSoundboardSound({
        attachmentId: attachment.id,
        name: input.name,
        glyph: input.glyph,
        trimStartSeconds: input.trimStartSeconds,
        trimEndSeconds: input.trimEndSeconds,
      });
      upsert(sound);
      return sound;
    },

    async update(soundId, patch) {
      const sound = await api.updateSoundboardSound(soundId, patch);
      upsert(sound);
      return sound;
    },

    async delete(soundId) {
      await api.deleteSoundboardSound(soundId);
      patchState({
        sounds: state.sounds.filter((sound) => sound.id !== soundId),
        error: null,
      });
    },

    async reorderSounds(soundIds) {
      const before = state.sounds;
      const byId = new Map(before.map((sound) => [sound.id, sound]));
      const ordered = soundIds.flatMap((id) => byId.get(id) ?? []);
      if (ordered.length !== before.length || new Set(soundIds).size !== soundIds.length) {
        throw new Error("A new order has to name every sound of the board once.");
      }
      patchState({ sounds: ordered, error: null });
      ordersPending += 1;
      try {
        await api.reorderSoundboardSounds(soundIds);
      } catch (cause) {
        // Only the order this call put up is taken back. Once something else
        // has replaced it, such as a later move still on its way, the
        // server's own order is fetched instead of guessing at it here.
        if (state.sounds === ordered) patchState({ sounds: before });
        else reloadRequested = true;
        throw cause;
      } finally {
        ordersPending -= 1;
        if (ordersPending === 0 && reloadRequested) void load();
      }
    },

    async updateSettings(patch) {
      try {
        patchState({ settings: await api.updateSoundboardSettings(patch), error: null });
      } catch (cause) {
        patchState({ error: "soundboard.rulesFailed" });
        throw cause;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      announcements.clear();
      stopCooldownTimer();
      for (const timer of playTimers) clearTimeout(timer);
      playTimers.clear();
      audio.close();
      listeners.clear();
      liveListeners.clear();
    },
  };
}
