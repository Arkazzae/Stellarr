import type { UserId, VoiceOccupant } from "@/lib/api/types";
import type { VoiceSignal } from "@/lib/realtime/types";
import {
  decodeRtcCandidate,
  decodeRtcDescription,
  decodeRtcState,
  encodeRtcCandidate,
} from "@/lib/rtc/protocol";
import type { VoiceIceProvider } from "./iceSession";
import type { ParticipantPreferencesStore } from "./participantPreferences";
import type { CallHealth } from "./webrtcHealth";
import type { LocalMicrophone } from "./webrtcMicrophone";
import { applyEncoding, createPeer, type Negotiator, type Peer } from "./webrtcPeer";
import type { RemoteAudio } from "./webrtcRemoteAudio";

export interface MeshDeps {
  readonly selfUserId: UserId;
  readonly ice: VoiceIceProvider;
  readonly preferences: ParticipantPreferencesStore;
  readonly negotiator: Negotiator;
  readonly remoteAudio: RemoteAudio;
  readonly microphone: LocalMicrophone;
  readonly health: CallHealth;
  /** The send ceiling the adaptive controller currently allows. */
  bitrate(): number;
  /** Hand a signal to the hub on behalf of the call. */
  send(signal: Omit<VoiceSignal, "channelId" | "protocolVersion">): Promise<void>;
  /** Tell one peer where this side stands, which it may have missed. */
  announceTo(peer: Peer): void;
  session(): number;
  isStale(session: number): boolean;
  /** What a peer publishes to the UI has changed. */
  changed(): void;
}

/**
 * The connections to everyone else in the channel: who is in it, how each one
 * is set up and torn down, and the signals that arrive from them.
 */
export class Mesh {
  constructor(
    readonly peers: Map<UserId, Peer>,
    private readonly deps: MeshDeps,
  ) {}

  /** Bring the connections in line with the hub's list of participants. */
  async reconcile(participants: VoiceOccupant[]): Promise<void> {
    const session = this.deps.session();
    const seen = new Set<UserId>();

    for (const participant of participants) {
      if (participant.userId === this.deps.selfUserId) continue;
      seen.add(participant.userId);
      const existing = this.peers.get(participant.userId);
      if (existing) {
        existing.displayName = participant.displayName;
        existing.muted = participant.muted;
        continue;
      }
      await this.create(participant);
      // The call may have ended while this peer was being offered.
      if (this.deps.isStale(session)) return;
    }

    for (const userId of [...this.peers.keys()]) {
      if (!seen.has(userId)) this.drop(userId);
    }
    this.deps.changed();
  }

  drop(userId: UserId): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.peers.delete(userId);
    this.deps.health.syncTransport();
    this.deps.remoteAudio.release(peer);
    peer.candidates.close();
    peer.watchdog.dispose();
    const { connection } = peer;
    connection.onicecandidate = null;
    connection.ontrack = null;
    connection.onnegotiationneeded = null;
    connection.onconnectionstatechange = null;
    try {
      connection.close();
    } catch {
      // Already closed.
    }
  }

  dropAll(): void {
    for (const userId of [...this.peers.keys()]) this.drop(userId);
  }

  /** Replace a connection that can no longer be trusted, keeping the person. */
  async rebuild(peer: Peer): Promise<void> {
    if (this.peers.get(peer.userId) !== peer) return;
    const occupant: VoiceOccupant = {
      userId: peer.userId,
      displayName: peer.displayName,
      muted: peer.muted,
    };
    this.drop(peer.userId);
    try {
      await this.create(occupant);
    } catch {
      // Reconciliation or the recovery watchdog will retry this one peer.
    }
  }

  /** Offer again to every peer that is free to take one. */
  async renegotiateAll(): Promise<void> {
    await Promise.all(
      [...this.peers.values()]
        .filter((peer) => peer.connection.signalingState === "stable")
        .map((peer) => this.deps.negotiator.offer(peer)),
    );
  }

  async applyMicEncoding(): Promise<void> {
    const bitrate = this.deps.bitrate();
    await Promise.all(
      [...this.peers.values()].map((peer) =>
        peer.micSender ? applyEncoding(peer.micSender, bitrate) : undefined,
      ),
    );
  }

  async handleSignal(signal: VoiceSignal): Promise<void> {
    const from = signal.fromUserId;
    if (!from || from === this.deps.selfUserId) return;
    const peer = this.peers.get(from);
    if (!peer) return;

    try {
      if (signal.kind === "state") {
        const state = decodeRtcState(signal.payload);
        if (state) {
          peer.muted = state.muted;
          this.deps.changed();
        }
      } else if (signal.kind === "candidate") {
        const candidate = decodeRtcCandidate(signal.payload);
        if (candidate !== undefined) await peer.candidates.add(candidate);
      } else {
        const description = decodeRtcDescription(signal.payload, signal.kind);
        if (description) await this.deps.negotiator.receive(peer, description);
      }
    } catch {
      // A single bad frame must not tear down the session.
    }
  }

  private async create(participant: VoiceOccupant): Promise<void> {
    const { negotiator } = this.deps;
    const peer = createPeer({
      user: participant,
      selfUserId: this.deps.selfUserId,
      iceServers: this.deps.ice.current(),
      // How this person sounded last time is how they start this time.
      preference: this.deps.preferences.get(participant.userId),
      createVoice: () => this.deps.remoteAudio.createVoice(),
      recovery: this.deps.health.recovery,
    });
    const { connection } = peer;
    this.peers.set(participant.userId, peer);
    this.deps.health.syncTransport();

    const capture = this.deps.microphone.capture;
    if (capture) {
      try {
        peer.micSender = connection.addTrack(capture.track, capture.stream);
      } catch {
        // A connection that cannot take the track is about to be rebuilt.
      }
    }
    negotiator.tuneMicSender(peer);

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream && event.track.kind === "audio") {
        this.deps.remoteAudio.receive(peer, stream, event.track);
      }
    };
    connection.onicecandidate = (event) => {
      void this.deps.send({
        kind: "candidate",
        toUserId: peer.userId,
        payload: encodeRtcCandidate(event.candidate ? event.candidate.toJSON() : null),
      });
    };
    connection.onnegotiationneeded = () => {
      void negotiator.offer(peer);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "closed") this.drop(peer.userId);
      else this.deps.health.onConnectionState(peer);
    };

    if (!peer.polite) await negotiator.offer(peer);
    this.deps.announceTo(peer);
  }
}
