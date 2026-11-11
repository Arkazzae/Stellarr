import type { VoiceOccupant } from "@/lib/api/types";
import type { MediaSessionClosedEvent, MediaSignal, VoiceSignal } from "@/lib/realtime/types";
import type { MediaServerSignalKind } from "@/lib/rtc/protocol";
import type { NetworkSample } from "./bitrate";
import type { MediaCounters, StatsLike } from "./stats";
import type { VoiceTransportState } from "./types";
import type { Link } from "./webrtcPeer";

/** What the topology says about media; the signalling half of the state is the call's own. */
export type TransportReport = Omit<VoiceTransportState, "signaling">;

/** One link's statistics from one round of sampling. */
export interface LinkReading {
  readonly link: Link;
  /** Loss and round trip, or null while the report has neither. */
  readonly network: NetworkSample | null;
  /** The link's cumulative audio RTP counters, or null before it has any. */
  readonly media: MediaCounters | null;
  /**
   * The whole report, for a topology that needs more than the summary, such
   * as counters per receiving section. Null when `getStats` failed.
   */
  readonly report: StatsLike | null;
}

/**
 * One round of statistics, taken by the topology. The call reads `readings`
 * for its diagnostics and calls `settle` only while the round still belongs to
 * the call in progress, so a round that finished after the call ended changes
 * nothing.
 */
export interface StatsRound {
  readonly readings: readonly LinkReading[];
  /**
   * Prove media flow from this round, bring the transport state up to date
   * and report a connection that carries nothing. `selfMuted` excuses this
   * side from sending.
   */
  settle(selfMuted: boolean): void;
}

/**
 * How the people in a call are connected to each other: the one part of the
 * call that differs between a browser mesh and a media server.
 *
 * `WebRtcVoiceClient` keeps everything that does not: capture, playback, the
 * people and their streams (`webrtcParticipant`), settings, the stats and
 * credential timers (`CallHealth`). It drives a topology only through this
 * interface. A topology owns its connections (`Link`) and the people in the
 * shared map it is given: it adds a person when the occupancy snapshot names
 * them and removes them when it no longer does.
 */
export interface CallTopology {
  /**
   * The hub confirmed this side's seat: `JoinVoice` succeeded on a join,
   * after an administrator move, or after a hub reconnect. Whatever the seat
   * needs beyond the occupancy snapshot is set up here. Never rejects.
   */
  seated(): Promise<void>;
  /** Bring the people and the connections in line with the hub's occupancy snapshot. */
  reconcile(participants: readonly VoiceOccupant[]): Promise<void>;
  /**
   * An `offer`, `answer` or `candidate` frame relayed over `VoiceSignal`.
   * `state` frames describe a person and never reach the topology.
   */
  handleSignal(signal: VoiceSignal): Promise<void>;
  /** One signal from the media server. A topology without one has nothing to do with it. */
  handleMediaSignal(signal: MediaSignal<MediaServerSignalKind>): Promise<void>;
  /** The media plane ended a media session. A topology without one has nothing to do with it. */
  mediaSessionClosed(event: MediaSessionClosedEvent): void;
  /** Offer again on every link that is free to take an offer. */
  renegotiate(): Promise<void>;
  /** Cap every microphone sender at the adaptive controller's current ceiling. */
  applyMicEncoding(): Promise<void>;
  /** Close every connection and forget every person. Captures stay open. */
  dropAll(): void;
  /** Repair the links that are down, leaving working ones alone. */
  repairUnhealthy(): Promise<void>;
  /** Replace a link that can no longer be trusted, e.g. a sender refused even a rollback. */
  rebuild(link: Link): Promise<void>;
  /**
   * The links this side publishes on: where the microphone, camera and
   * screen put their senders, and what fresh ICE servers are given to.
   */
  links(): readonly Link[];
  /** `media`, `peerCount` and `connectedPeerCount` as the dock should show them now. */
  transport(): TransportReport;
  /** Read every link's statistics; reading changes nothing until the round is settled. */
  sample(): Promise<StatsRound>;
}
