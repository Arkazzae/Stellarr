import type { ApiClient } from "@/lib/api/client";
import type { RealtimeClient } from "@/lib/realtime/types";
import type { VoiceSettings } from "@/lib/voice/settings";
import type { Sound, SoundboardPort, SoundboardState } from "@/ports";

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
  let arrivalsAudible = true;
  let loading: Promise<void> | null = null;
  let reloadRequested = false;
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

  const stopCooldownTimer = (): void => {
    if (cooldownTimer !== null) clearTimeout(cooldownTimer);
    cooldownTimer = null;
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
      void load();
    }),
  ];

  return {
    getSnapshot: () => state,
    load,
    cooldownRemaining: () => Math.max(0, readyAt - Date.now()),

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
        readyAt = Date.now() + COOLDOWN_MS;
        notify();
        cooldownTimer = setTimeout(notify, COOLDOWN_MS);
      }
      try {
        await realtime.playSoundboard(channelId, soundId);
      } catch {
        readyAt = 0;
        stopCooldownTimer();
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
      audio.close();
      listeners.clear();
    },
  };
}
