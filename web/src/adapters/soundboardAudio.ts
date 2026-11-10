import type { SoundboardPlayedEvent, SoundboardSound } from "@/lib/api/types";
import type { VoiceSettings } from "@/lib/voice/settings";

type LegacyWindow = Window & { webkitAudioContext?: typeof AudioContext };
type RoutableContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

/** Plays soundboard clips on a Web Audio clock shared by every client. */
export interface SoundboardAudio {
  /** Creates the context if needed and wakes it; call from a user gesture. */
  prepare(): void;
  /** Fetches and decodes clips ahead of time so a press starts without a delay. */
  preload(sounds: readonly SoundboardSound[]): void;
  setDeafened(deafened: boolean): void;
  /** A percentage from 0 to 100; anything else counts as full volume. */
  setVolume(volume: number): void;
  /**
   * Starts the clip at the moment the server named, translated to this
   * device's clock. A clip that is already under way joins part-way through.
   */
  schedule(event: SoundboardPlayedEvent, serverOffsetMs: number): Promise<void>;
  /** Releases the context for good; later calls do nothing. */
  close(): void;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The part of a clip worth playing, in seconds. Trim values come from the
 * server and are clamped to what the decoded audio really holds.
 */
function playableWindow(
  sound: SoundboardSound,
  duration: number,
): { start: number; end: number } {
  const start = Math.min(duration, Math.max(0, finiteOr(sound.trimStartSeconds, 0)));
  const end = Math.min(duration, Math.max(start, finiteOr(sound.trimEndSeconds, duration)));
  return { start, end };
}

export function createSoundboardAudio(
  getSettings: () => VoiceSettings,
): SoundboardAudio {
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let deafened = false;
  let volume = 100;
  let closed = false;

  const applyMasterGain = (): void => {
    if (master !== null) master.gain.value = deafened ? 0 : volume / 100;
  };

  const ensureContext = (): AudioContext | null => {
    if (closed) return null;
    if (context !== null) return context;
    if (typeof window === "undefined") return null;
    const Constructor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as LegacyWindow).webkitAudioContext;
    if (Constructor === undefined) return null;
    context = new Constructor();
    master = context.createGain();
    applyMasterGain();
    master.connect(context.destination);
    return context;
  };

  const routeOutput = async (target: AudioContext): Promise<void> => {
    const routable: RoutableContext = target;
    if (routable.setSinkId === undefined) return;
    // The empty id restores the system default. Skipping the call would leave
    // the context pinned to a headset that was selected earlier.
    await routable.setSinkId(getSettings().outputDeviceId ?? "").catch(() => undefined);
  };

  const decoded = (sound: SoundboardSound): Promise<AudioBuffer> => {
    const cached = buffers.get(sound.url);
    if (cached !== undefined) return cached;
    const pending = fetch(sound.url, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`Audio asset responded ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => {
        // Looked up only now: a download that outlives close() must not bring
        // a context back to life.
        const target = ensureContext();
        if (target === null) throw new Error("Web Audio is unavailable");
        return target.decodeAudioData(bytes);
      });
    buffers.set(sound.url, pending);
    pending.catch(() => buffers.delete(sound.url));
    return pending;
  };

  return {
    prepare() {
      const target = ensureContext();
      if (target === null) return;
      void target.resume().catch(() => undefined);
      void routeOutput(target);
    },

    preload(sounds) {
      if (closed) return;
      for (const sound of sounds) decoded(sound).catch(() => undefined);
    },

    setDeafened(value) {
      deafened = value;
      applyMasterGain();
    },

    setVolume(value) {
      volume = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 100;
      applyMasterGain();
    },

    async schedule(event, serverOffsetMs) {
      const target = ensureContext();
      if (target === null) return;
      // Each await below may outlive the context, so each is followed by a check.
      const stale = (): boolean => closed || context !== target;
      await target.resume().catch(() => undefined);
      if (stale()) return;
      await routeOutput(target);
      if (stale()) return;
      const buffer = await decoded(event.sound);
      if (stale()) return;

      const targetClientMs = event.startsAtUnixMs - serverOffsetMs;
      const now = Date.now();
      const { start, end } = playableWindow(event.sound, buffer.duration);
      const offset = Math.min(end, start + Math.max(0, (now - targetClientMs) / 1000));
      const remaining = end - offset;
      if (remaining <= 0) return;

      const source = target.createBufferSource();
      const gain = target.createGain();
      gain.gain.value = 1;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(master ?? target.destination);
      const release = (): void => {
        source.disconnect();
        gain.disconnect();
      };
      source.onended = release;
      const wait = Math.max(0, (targetClientMs - now) / 1000);
      try {
        source.start(target.currentTime + wait, offset, remaining);
      } catch (cause) {
        source.onended = null;
        release();
        throw cause;
      }
    },

    close() {
      if (closed) return;
      closed = true;
      buffers.clear();
      const closing = context;
      context = null;
      master?.disconnect();
      master = null;
      if (closing !== null) void closing.close().catch(() => undefined);
    },
  };
}
