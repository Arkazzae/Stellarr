import type { Translator } from "@/i18n";
import type { UserId } from "@/lib/api/types";
import { receivedAudioByMid } from "./stats";
import type { VoiceStateStore } from "./store";
import type { VoiceMediaState } from "./types";
import { mediaServerStalledError } from "./webrtcErrors";
import { isSilent, proveMediaFlow } from "./webrtcHealth";
import type { Participant } from "./webrtcParticipant";
import type { Link } from "./webrtcPeer";
import type { TransportReport, LinkReading } from "./webrtcTopology";

/**
 * A microphone section is judged again only this long after its last
 * judgement. Packets come every 20 ms while somebody talks and every 400 ms in
 * DTX silence, so two rounds closer than this can see a working microphone
 * stand still.
 */
const MIN_JUDGED_GAP_MS = 500;

/** A section's packet count when it was last judged, and when that was. */
interface Baseline {
  readonly packets: number;
  readonly at: number;
}

export interface SfuHealthEnv {
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly store: VoiceStateStore;
  readonly people: ReadonlyMap<UserId, Participant>;
  /**
   * How long a person's microphone may take to arrive, counted from when the
   * connection came up or the person joined, whichever is later, before its
   * absence makes the call degraded.
   */
  readonly arrivalGraceMs: number;
}

/** Where the connection to the media server stands, as the topology knows it. */
export interface SfuCondition {
  /** The connection of the current media session, or null while there is none. */
  link: Link | null;
  /** A connection was lost and is being replaced, and no replacement has proven media yet. */
  recovering: boolean;
  /** Every replacement allowed in a row has failed. */
  exhausted: boolean;
  /** When the connection last came up (`Date.now()`), or null while it is not up. */
  upAt: number | null;
}

/**
 * Whether the one connection to the media server really works, and whose
 * microphone really arrives on it ("Client state and recovery" of
 * docs/stellarr-media.md).
 *
 * Proof keeps its v1 meaning: cumulative RTP counters that advance, never a
 * state the browser reports. Outgoing audio is proven for the connection as a
 * whole; incoming audio per person, from the receiving section the directory
 * files as their microphone. A muted person is excused from sending once
 * their microphone has a section. Somebody whose microphone has not arrived
 * yet is pending rather than missing for `arrivalGraceMs`: right after the
 * connection comes up, or right after they join, their track is still being
 * negotiated, and nothing is wrong.
 */
export class SfuHealth {
  /** People whose microphone arrived in the last round. */
  private arriving = new Set<UserId>();
  /** Packets received per microphone section when it was last judged. */
  private baselines = new Map<string, Baseline>();
  /**
   * The connection has been ready or connected since it came up. Then somebody
   * who has only just joined does not make the call look like it is starting.
   */
  private settled = false;
  /** When each person in the room was first seen, for their arrival grace. */
  private readonly seenAt = new Map<UserId, number>();

  constructor(private readonly env: SfuHealthEnv) {}

  transport(condition: SfuCondition): TransportReport {
    const { people } = this.env;
    const peerCount = people.size;
    const { link } = condition;
    const up = link !== null && link.connection.connectionState === "connected";
    const now = Date.now();
    this.trackArrivals(now);

    let connectedPeerCount = 0;
    let pendingPeerCount = 0;
    if (up) {
      for (const userId of people.keys()) {
        if (this.arriving.has(userId)) connectedPeerCount += 1;
        else if (this.isPending(userId, condition.upAt, now)) pendingPeerCount += 1;
      }
    }
    const media = this.media(condition, up, connectedPeerCount, pendingPeerCount);
    return { media, peerCount, connectedPeerCount };
  }

  /**
   * Prove what one round of statistics shows. `microphoneMids` names the
   * sections each person's microphone is filed on.
   */
  settle(
    link: Link,
    reading: LinkReading,
    selfMuted: boolean,
    microphoneMids: (person: Participant) => readonly string[],
  ): void {
    if (link.connection.connectionState !== "connected") {
      this.forget();
      return;
    }
    // Only this side's sending is judged here; whoever else is heard is
    // judged per person below.
    proveMediaFlow(link.flow, reading.media, { selfMuted, remoteMuted: true });

    const now = Date.now();
    const received = reading.report ? receivedAudioByMid(reading.report) : new Map<string, number>();
    const arriving = new Set<UserId>();
    const baselines = new Map<string, Baseline>();
    for (const person of this.env.people.values()) {
      const mids = microphoneMids(person);
      if (mids.length === 0) continue;
      let judged = false;
      let advanced = false;
      for (const mid of mids) {
        const before = this.baselines.get(mid);
        if (before && now - before.at < MIN_JUDGED_GAP_MS) {
          // Too soon after the last judgement to tell silence from a pause.
          baselines.set(mid, before);
          continue;
        }
        const packets = received.get(mid) ?? 0;
        judged = true;
        if (packets > (before?.packets ?? 0)) advanced = true;
        baselines.set(mid, { packets, at: now });
      }
      const heard = judged ? advanced : this.arriving.has(person.userId);
      if (heard || person.muted) arriving.add(person.userId);
    }
    this.arriving = arriving;
    this.baselines = baselines;
  }

  /** Say what is wrong with the connection, or take back what no longer is. */
  report(condition: SfuCondition): void {
    const { store, translate } = this.env;
    const { link } = condition;
    if (condition.exhausted) return;
    if (link !== null && isSilent(link)) {
      store.set({ error: mediaServerStalledError(translate) });
      return;
    }
    const { error, transport } = store.getSnapshot();
    if (
      error?.kind === "transport" &&
      (transport.media === "connected" || transport.media === "ready")
    ) {
      store.set({ error: null });
    }
  }

  /** A connection ended; nothing proven on it says anything about the next. */
  forget(): void {
    this.arriving = new Set();
    this.baselines = new Map();
    this.settled = false;
  }

  /** Remember when each person was first seen, and forget whoever left. */
  private trackArrivals(now: number): void {
    const { people } = this.env;
    for (const userId of people.keys()) {
      if (!this.seenAt.has(userId)) this.seenAt.set(userId, now);
    }
    for (const userId of [...this.seenAt.keys()]) {
      if (!people.has(userId)) this.seenAt.delete(userId);
    }
  }

  /** Whether a person whose microphone has not arrived is still within their grace. */
  private isPending(userId: UserId, upAt: number | null, now: number): boolean {
    const since = Math.max(this.seenAt.get(userId) ?? now, upAt ?? now);
    return now - since < this.env.arrivalGraceMs;
  }

  private media(
    condition: SfuCondition,
    up: boolean,
    connectedPeerCount: number,
    pendingPeerCount: number,
  ): VoiceMediaState {
    if (condition.exhausted) return "failed";
    const { link, recovering } = condition;
    if (link === null || !up) {
      const state = link?.connection.connectionState;
      return recovering || state === "disconnected" || state === "failed" ? "degraded" : "connecting";
    }
    if (!link.flow.verified) return recovering || isSilent(link) ? "degraded" : "connecting";
    const peerCount = this.env.people.size;
    if (peerCount === 0) return this.provenAs("ready");
    if (connectedPeerCount === peerCount) return this.provenAs("connected");
    // Nobody is missing yet, only late. A call that already works, or already
    // hears somebody, stays connected; one that is only starting is connecting.
    if (connectedPeerCount + pendingPeerCount === peerCount) {
      return this.settled || connectedPeerCount > 0 ? this.provenAs("connected") : "connecting";
    }
    return "degraded";
  }

  /** The call works on this connection; remember that, and say so. */
  private provenAs(media: "ready" | "connected"): VoiceMediaState {
    this.settled = true;
    return media;
  }
}
