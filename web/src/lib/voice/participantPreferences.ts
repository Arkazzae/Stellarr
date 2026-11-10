import { clampParticipantVolume } from "./remoteStrip";

/**
 * How one other person sounds to *you*: volume, gate, noise removal.
 *
 * These are receiver-side choices about someone else's microphone, so they
 * belong to the listener and to nobody else: never signalled to the person,
 * never written to the server. But they are also the choices people make
 * about the same three friends every evening, so they are kept across
 * reloads. The one who chews is still chewing tomorrow; the gate you set on
 * them should still be there.
 *
 * Stored per signed-in account, like the voice settings, so two people
 * sharing a browser do not inherit each other's opinions of a third.
 */
export interface ParticipantPreference {
  /** Receiver-side level, 0..200 percent. */
  volume: number;
  /** Their strip is muted between words. */
  gated: boolean;
  /** Their strip runs through a local suppressor before the gate. */
  suppressed: boolean;
}

export const DEFAULT_PARTICIPANT_PREFERENCE: Readonly<ParticipantPreference> =
  Object.freeze({ volume: 100, gated: false, suppressed: false });

export const PARTICIPANT_PREFERENCES_VERSION = 1;
export const PARTICIPANT_PREFERENCES_KEY = "stellarr.voice.participants";

/**
 * Enough for everyone a person actually talks to, small enough that a
 * corrupt or gigantic entry can never make reading the store expensive. The
 * longest-untouched entries go first.
 */
export const MAX_PARTICIPANT_PREFERENCES = 200;

/** A preference plus when it was last touched, so pruning drops stale people. */
type Entry = ParticipantPreference & { at: number };

export function participantPreferencesKeyForUser(userId: string): string {
  return `${PARTICIPANT_PREFERENCES_KEY}.user.${encodeURIComponent(userId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefault(preference: ParticipantPreference): boolean {
  return (
    preference.volume === DEFAULT_PARTICIPANT_PREFERENCE.volume &&
    preference.gated === DEFAULT_PARTICIPANT_PREFERENCE.gated &&
    preference.suppressed === DEFAULT_PARTICIPANT_PREFERENCE.suppressed
  );
}

/** Reads one stored entry; each field that is missing or malformed falls back alone. */
function parseEntry(value: unknown): Entry | null {
  if (!isRecord(value)) return null;
  const { volume, gated, suppressed, at } = value;
  const entry: Entry = {
    volume:
      typeof volume === "number"
        ? clampParticipantVolume(volume)
        : DEFAULT_PARTICIPANT_PREFERENCE.volume,
    gated: typeof gated === "boolean" ? gated : DEFAULT_PARTICIPANT_PREFERENCE.gated,
    suppressed:
      typeof suppressed === "boolean"
        ? suppressed
        : DEFAULT_PARTICIPANT_PREFERENCE.suppressed,
    at: typeof at === "number" && Number.isFinite(at) ? at : 0,
  };
  return isDefault(entry) ? null : entry;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Blocked by a cookie policy.
    return null;
  }
}

export class ParticipantPreferencesStore {
  private entries = new Map<string, Entry>();
  private key: string | null = null;

  /**
   * @param storage `null` keeps everything in memory for the session: what a
   *   test wants, and what a browser with storage blocked gets.
   * @param ownerId the signed-in account; without one nothing is persisted
   *   until `setOwner` names it.
   * @param now the clock that stamps each change.
   */
  constructor(
    private readonly storage: Storage | null = browserStorage(),
    ownerId: string | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (ownerId !== null) this.setOwner(ownerId);
  }

  /** Switch to, and load, the account's own namespace. */
  setOwner(ownerId: string): void {
    const key = participantPreferencesKeyForUser(ownerId);
    if (key === this.key) return;
    this.key = key;
    this.entries = this.load();
  }

  get(userId: string): ParticipantPreference {
    const entry = this.entries.get(userId);
    if (!entry) return { ...DEFAULT_PARTICIPANT_PREFERENCE };
    return { volume: entry.volume, gated: entry.gated, suppressed: entry.suppressed };
  }

  /** Applies the fields of `patch` that have the right type and returns the result. */
  set(userId: string, patch: Partial<ParticipantPreference>): ParticipantPreference {
    const current = this.get(userId);
    const next: ParticipantPreference = {
      volume:
        typeof patch.volume === "number"
          ? clampParticipantVolume(patch.volume)
          : current.volume,
      gated: typeof patch.gated === "boolean" ? patch.gated : current.gated,
      suppressed:
        typeof patch.suppressed === "boolean" ? patch.suppressed : current.suppressed,
    };
    // A person set back to defaults is a person with no entry: the store
    // records opinions, not the absence of them.
    if (isDefault(next)) this.entries.delete(userId);
    else this.entries.set(userId, { ...next, at: this.now() });
    this.prune();
    this.save();
    return next;
  }

  /** How many people have a non-default preference. */
  size(): number {
    return this.entries.size;
  }

  private prune(): void {
    const surplus = this.entries.size - MAX_PARTICIPANT_PREFERENCES;
    if (surplus <= 0) return;
    const oldestFirst = [...this.entries].sort(([, a], [, b]) => a.at - b.at);
    for (const [userId] of oldestFirst.slice(0, surplus)) this.entries.delete(userId);
  }

  private load(): Map<string, Entry> {
    const entries = new Map<string, Entry>();
    if (!this.storage || this.key === null) return entries;

    let parsed: unknown;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return entries;
      parsed = JSON.parse(raw);
    } catch {
      return entries;
    }
    if (!isRecord(parsed) || parsed["version"] !== PARTICIPANT_PREFERENCES_VERSION) {
      return entries;
    }
    const stored = parsed["entries"];
    if (!isRecord(stored)) return entries;

    for (const [userId, value] of Object.entries(stored)) {
      const entry = parseEntry(value);
      if (entry) entries.set(userId, entry);
    }
    return entries;
  }

  /** Writes only what differs from the defaults; the stored shape is versioned. */
  private save(): void {
    if (!this.storage || this.key === null) return;
    const entries = Object.fromEntries(
      [...this.entries].map(([userId, entry]) => [
        userId,
        {
          ...(entry.volume !== DEFAULT_PARTICIPANT_PREFERENCE.volume
            ? { volume: entry.volume }
            : {}),
          ...(entry.gated ? { gated: true } : {}),
          ...(entry.suppressed ? { suppressed: true } : {}),
          at: entry.at,
        },
      ]),
    );
    try {
      this.storage.setItem(
        this.key,
        JSON.stringify({ version: PARTICIPANT_PREFERENCES_VERSION, entries }),
      );
    } catch {
      // A full or blocked store must not break the call that set this.
    }
  }
}
