import type { MessageKey } from "@/i18n";
import type {
  ChannelId,
  SoundboardSettings,
  SoundboardSound,
  UserId,
} from "@/lib/api/types";

import type { Unsubscribe } from "./chat";

/** Short clips played into the voice channel for everyone in it. */
export interface SoundboardPort {
  getSnapshot(): SoundboardState;
  load(): Promise<void>;
  /** Called from the voice-channel click so the autoplay policy is unlocked. */
  preparePlayback(): void;
  /** Silences or restores every locally rendered clip immediately. */
  setDeafened(deafened: boolean): void;
  /** Sets the local level, including for clips already playing. */
  setVolume(volume: number): void;
  /**
   * Whether arrivals may be announced to this listener at all.
   *
   * It is the preference that silences the shared join chime, passed on here
   * because a person's own arrival clip announces the same event: someone who
   * asked not to hear comings and goings did not ask for a longer version.
   */
  setArrivalsAudible(audible: boolean): void;
  play(soundId: string, channelId: ChannelId): Promise<void>;
  /**
   * Plays one clip in this tab only, so a person choosing an arrival sound
   * hears exactly what a room would hear. Nothing is sent anywhere.
   */
  preview(sound: Sound): Promise<void>;
  /**
   * Whether this person's arrival was just announced with their own clip, in
   * which case the shared chime would say the same thing twice. Reading
   * consumes the answer: the next arrival asks again.
   */
  takeJoinAnnouncement(userId: UserId): boolean;
  create(input: NewSound): Promise<Sound>;
  update(soundId: string, patch: SoundPatch): Promise<Sound>;
  delete(soundId: string): Promise<void>;
  updateSettings(patch: Partial<SoundboardSettings>): Promise<void>;
  dispose(): void;
  /** Milliseconds until `play` is accepted again; 0 when ready. */
  cooldownRemaining(): number;
  subscribe(listener: () => void): Unsubscribe;
}

export interface SoundboardState {
  sounds: Sound[];
  settings: SoundboardSettings;
  canManage: boolean;
  supported: boolean;
  loading: boolean;
  /** What went wrong, as a catalog key for the reader to translate. */
  error: MessageKey | null;
}

export type Sound = SoundboardSound;

export interface NewSound {
  file: File;
  name: string;
  glyph: string;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
}

export type SoundPatch = Partial<
  Pick<Sound, "name" | "glyph" | "trimStartSeconds" | "trimEndSeconds">
>;
