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

export interface SfuHealthEnv {
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly store: VoiceStateStore;
  readonly people: ReadonlyMap<UserId, Participant>;
}

/** Where the connection to the media server stands, as the topology knows it. */
export interface SfuCondition {
  /** The connection of the current media session, or null while there is none. */
  link: Link | null;
  /** A connection was lost and is being replaced, and no replacement has proven media yet. */
  recovering: boolean;
  /** Every replacement allowed in a row has failed. */
  exhausted: boolean;
}

/**
 * Whether the one connection to the media server really works, and whose
 * microphone really arrives on it ("State in the sfu topology" of
 * docs/STELLARR_MEDIA.md).
 *
 * Proof keeps its v1 meaning: cumulative RTP counters that advance, never a
 * state the browser reports. Outgoing audio is proven for the connection as a
 * whole; incoming audio per person, from the receiving section the directory
 * files as their microphone. A muted person is excused from sending, as in
 * the mesh, once their microphone has a section.
 */
export class SfuHealth {
  /** People whose microphone arrived in the last round. */
  private arriving = new Set<UserId>();
  /** Packets received per audio section at the last round. */
  private lastReceived = new Map<string, number>();

  constructor(private readonly env: SfuHealthEnv) {}

  transport(condition: SfuCondition): TransportReport {
    const { people } = this.env;
    const peerCount = people.size;
    const { link } = condition;
    const up = link !== null && link.connection.connectionState === "connected";
    const connectedPeerCount = up
      ? [...people.keys()].filter((userId) => this.arriving.has(userId)).length
      : 0;
    return { media: this.media(condition, up, connectedPeerCount), peerCount, connectedPeerCount };
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

    const received = reading.report ? receivedAudioByMid(reading.report) : new Map<string, number>();
    const arriving = new Set<UserId>();
    for (const person of this.env.people.values()) {
      const mids = microphoneMids(person);
      if (mids.length === 0) continue;
      const advanced = mids.some((mid) => (received.get(mid) ?? 0) > (this.lastReceived.get(mid) ?? 0));
      if (advanced || person.muted) arriving.add(person.userId);
    }
    this.arriving = arriving;
    this.lastReceived = received;
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
    this.lastReceived = new Map();
  }

  private media(condition: SfuCondition, up: boolean, connectedPeerCount: number): VoiceMediaState {
    if (condition.exhausted) return "failed";
    const { link, recovering } = condition;
    if (link === null || !up) {
      const state = link?.connection.connectionState;
      return recovering || state === "disconnected" || state === "failed" ? "degraded" : "connecting";
    }
    if (!link.flow.verified) return recovering || isSilent(link) ? "degraded" : "connecting";
    const peerCount = this.env.people.size;
    if (peerCount === 0) return "ready";
    return connectedPeerCount === peerCount ? "connected" : "degraded";
  }
}
