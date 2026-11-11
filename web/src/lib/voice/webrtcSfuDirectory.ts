import type { UserId } from "@/lib/api/types";
import type { MediaTrack } from "@/lib/rtc/protocol";
import {
  receiveRemoteTrack,
  type Participant,
  type ParticipantMediaEnv,
} from "./webrtcParticipant";
import type { AudioSectionUse } from "./webrtcPeer";
import type { RemoteAudio } from "./webrtcRemoteAudio";

export interface TrackDirectoryEnv {
  /** Everyone the occupancy snapshot names; nobody else's track is played. */
  readonly people: ReadonlyMap<UserId, Participant>;
  /** Where a filed track goes: the person's sinks, streams and tiles. */
  readonly personMedia: ParticipantMediaEnv;
  readonly remoteAudio: Pick<RemoteAudio, "withdraw" | "route">;
}

/** A track that arrived on one receiving section of the connection. */
interface Arrival {
  readonly track: MediaStreamTrack;
  /** A stream of this track alone, made here; see `arrive`. */
  readonly stream: MediaStream;
}

/** What a track is filed as: whose, and under which of their stream ids. */
interface Filing {
  readonly person: Participant;
  readonly key: string;
  readonly kind: "audio" | "video";
}

/**
 * Whose track is whose on the one connection to the media server.
 *
 * Three things arrive on different paths and in any order: the tracks of the
 * connection (by `mid`), the media server's directory (which `mid` is whose,
 * and under which stream id), and the hub's occupancy snapshot (who is in the
 * room). A track is filed under a person only when all three agree, and
 * `place` brings what is filed in line with them after any of them changes.
 * So a track waits until a directory names its section, an entry waits until
 * the snapshot names its person, and whatever the directory or the snapshot
 * no longer lists stops playing, since a section the media server stops
 * forwarding only goes quiet and never ends.
 *
 * One directory belongs to one connection. A new connection starts with an
 * empty one.
 */
export class TrackDirectory {
  private entries = new Map<string, MediaTrack>();
  private readonly arrivals = new Map<string, Arrival>();
  private readonly filed = new Map<string, Filing>();

  constructor(private readonly env: TrackDirectoryEnv) {}

  /** The whole directory of the session, from an offer or a `tracks` signal. Never a delta. */
  update(tracks: readonly MediaTrack[]): void {
    this.entries = new Map(tracks.map((track) => [track.mid, track]));
    this.place();
  }

  /**
   * A track arrived on the section `mid`.
   *
   * It gets a stream of its own rather than the one the browser grouped it
   * into. The browser groups by the `msid` of the section, which the media
   * server copied from whatever the publisher chose; two publishers naming the
   * same stream would otherwise share one, and one person's sink would play
   * the other's sound.
   */
  arrive(mid: string | null, track: MediaStreamTrack): void {
    if (mid === null || this.arrivals.has(mid)) return;
    this.arrivals.set(mid, { track, stream: new MediaStream([track]) });
    this.place();
  }

  /** File what can be filed and withdraw what no longer holds. Idempotent. */
  place(): void {
    const { people } = this.env;

    for (const [mid, filing] of [...this.filed]) {
      const entry = this.entries.get(mid);
      const holds =
        entry !== undefined &&
        this.arrivals.has(mid) &&
        people.get(entry.userId) === filing.person &&
        entry.streamId === filing.key;
      if (!holds) this.unfile(mid, filing);
    }

    // Before any sound is placed, everyone learns which of their stream ids
    // carry a picture, so a share's sound never starts on the voice's sink.
    for (const entry of this.entries.values()) {
      if (entry.kind === "video") people.get(entry.userId)?.media.learnVideo(entry.streamId);
    }

    const waiting = [...this.arrivals].filter(([mid]) => !this.filed.has(mid));
    // Pictures first, for the same reason.
    waiting.sort(([, a], [, b]) => kindOrder(a.track) - kindOrder(b.track));
    for (const [mid, arrival] of waiting) {
      const entry = this.entries.get(mid);
      if (!entry || entry.kind !== arrival.track.kind) continue;
      const person = people.get(entry.userId);
      if (!person) continue;
      this.file(mid, arrival, person, entry.streamId);
    }
  }

  /**
   * What the audio section `mid` carries, when the directory names it. The
   * person's own account decides; a sound in a stream that also carries a
   * picture is taken for a share's only while the person is not known yet,
   * since a camera shares the voice's stream.
   */
  useOf(mid: string): AudioSectionUse | null {
    const entry = this.entries.get(mid);
    if (!entry || entry.kind !== "audio") return null;
    const person = this.env.people.get(entry.userId);
    const shared = person
      ? person.media.roleOf(entry.streamId) === "screen"
      : [...this.entries.values()].some(
          (other) =>
            other.kind === "video" && other.userId === entry.userId && other.streamId === entry.streamId,
        );
    return shared ? "received-shared-sound" : "speech";
  }

  /** The sections on which `person`'s microphone is filed. */
  microphoneMids(person: Participant): string[] {
    return [...this.filed].flatMap(([mid, filing]) =>
      filing.person === person &&
      filing.kind === "audio" &&
      person.media.roleOf(filing.key) === "microphone"
        ? [mid]
        : [],
    );
  }

  /** The connection is gone: withdraw everything it carried and forget it all. */
  clear(): void {
    for (const [mid, filing] of [...this.filed]) this.unfile(mid, filing);
    this.arrivals.clear();
    this.entries.clear();
  }

  private file(mid: string, arrival: Arrival, person: Participant, key: string): void {
    this.filed.set(mid, { person, key, kind: arrival.track.kind === "video" ? "video" : "audio" });
    receiveRemoteTrack(this.env.personMedia, person, arrival.track, arrival.stream, key);
  }

  private unfile(mid: string, filing: Filing): void {
    this.filed.delete(mid);
    const arrival = this.arrivals.get(mid);
    // Filed again under another key, an old handler would remove the new one.
    if (arrival) arrival.track.onended = null;

    const { person, key } = filing;
    if (filing.kind === "audio") {
      this.env.remoteAudio.withdraw(person, key);
      return;
    }
    person.media.removeVideo(key);
    // A share that ended takes its sound with it, which moves the sinks.
    this.env.remoteAudio.route(person);
    this.env.personMedia.changed();
  }
}

function kindOrder(track: MediaStreamTrack): number {
  return track.kind === "video" ? 0 : 1;
}
