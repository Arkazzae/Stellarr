import type { Translator } from "@/i18n";
import type { UserId, VoiceOccupant } from "@/lib/api/types";
import type { VoiceSignal } from "@/lib/realtime/types";
import {
  decodeRtcCandidate,
  decodeRtcDescription,
  encodeRtcCandidate,
  encodeRtcDescription,
} from "@/lib/rtc/protocol";
import type { VoiceIceProvider } from "./iceSession";
import type { ParticipantPreference, ParticipantPreferencesStore } from "./participantPreferences";
import type { VoiceSettings } from "./settings";
import type { VoiceStateStore } from "./store";
import type { LocalCamera, LocalScreen } from "./webrtcLocalVideo";
import { MeshHealth } from "./webrtcMeshHealth";
import type { LocalMicrophone } from "./webrtcMicrophone";
import { createParticipant, type Participant, type RemoteVoice } from "./webrtcParticipant";
import { applyEncoding, createLink, Negotiator, type Link, type LinkRecovery } from "./webrtcPeer";
import type { RemoteAudio } from "./webrtcRemoteAudio";
import type { CallTopology, StatsRound, TransportReport } from "./webrtcTopology";

/** One other person in a mesh call, and the connection that is theirs alone. */
export interface MeshPeer {
  readonly person: Participant;
  readonly link: Link;
}

export interface PeerInit {
  user: VoiceOccupant;
  selfUserId: UserId;
  iceServers: RTCIceServer[];
  /** How this account last heard the person. */
  preference: ParticipantPreference;
  /**
   * Builds the person's sinks. Called once the connection exists, so a
   * connection that cannot be constructed leaves no audio element behind.
   */
  createVoice(): RemoteVoice;
  recovery: LinkRecovery;
}

/** A person and their connection, born together: the connection first. */
export function createPeer(init: PeerInit): MeshPeer {
  const link = createLink({
    iceServers: init.iceServers,
    // Deterministic roles: the lexicographically larger id is the polite side.
    polite: init.selfUserId > init.user.userId,
    recovery: init.recovery,
  });
  const person = createParticipant({
    user: init.user,
    preference: init.preference,
    createVoice: init.createVoice,
  });
  return { person, link };
}

export interface MeshDeps {
  readonly selfUserId: UserId;
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly store: VoiceStateStore;
  readonly ice: VoiceIceProvider;
  readonly preferences: ParticipantPreferencesStore;
  readonly remoteAudio: RemoteAudio;
  readonly microphone: LocalMicrophone;
  readonly camera: LocalCamera;
  readonly screen: LocalScreen;
  /** Grace before a `disconnected` link is nudged with an ICE restart. */
  recoveryGraceMs?: number;
  settings(): VoiceSettings;
  /** The send ceiling the adaptive controller currently allows. */
  bitrate(): number;
  /** Whether the shared sound being sent has two channels. */
  screenAudioStereo(): boolean;
  /** Hand a signal to the hub on behalf of the call. */
  send(signal: Omit<VoiceSignal, "channelId" | "protocolVersion">): Promise<void>;
  /** Tell one person where this side stands, which they may have missed. */
  announceTo(userId: UserId): void;
  /** A track arrived from `person`: file it under them. */
  receiveTrack(person: Participant, track: MediaStreamTrack, stream: MediaStream): void;
  session(): number;
  /** The session in progress, or null between calls. */
  activeSession(): number | null;
  isStale(session: number): boolean;
  /** What a person publishes to the UI has changed. */
  changed(): void;
  /** What `transport()` reports may have changed. */
  transportChanged(): void;
}

/**
 * The browser mesh: a direct connection to everyone else in the channel. Who
 * is in it, how each connection is set up and torn down, and the signals that
 * arrive from the others.
 *
 * Each connection carries one person, so whatever arrives on it is theirs:
 * this is the one place that may conclude whose media it is from where it
 * came in.
 */
export class Mesh implements CallTopology {
  private readonly peers = new Map<UserId, MeshPeer>();
  /**
   * The peer each link was made for. It outlives the peer's place in the map,
   * so a description that finishes after its connection was dropped still
   * goes where it would have gone before.
   */
  private readonly owners = new WeakMap<Link, MeshPeer>();
  private readonly negotiator: Negotiator;
  private readonly health: MeshHealth;

  constructor(
    /** Everyone else in the call, shared with the client that shows and plays them. */
    private readonly people: Map<UserId, Participant>,
    private readonly deps: MeshDeps,
  ) {
    this.negotiator = new Negotiator({
      settings: () => deps.settings(),
      bitrate: () => deps.bitrate(),
      screenAudioStereo: () => deps.screenAudioStereo(),
      send: async (link, type, sdp) => {
        const peer = this.owners.get(link);
        if (!peer) return;
        await deps.send({
          kind: type,
          toUserId: peer.person.userId,
          payload: encodeRtcDescription(type, sdp),
        });
      },
      remoteMediaLearned: (link, sdp) => {
        const peer = this.owners.get(link);
        if (!peer) return;
        peer.person.media.learnFromSdp(sdp);
        deps.remoteAudio.route(peer.person);
      },
    });
    this.health = new MeshHealth({
      translate: deps.translate,
      store: deps.store,
      peers: this.peers,
      recoveryGraceMs: deps.recoveryGraceMs,
      activeSession: () => deps.activeSession(),
      reoffer: (link) => this.negotiator.offer(link),
      transportChanged: () => deps.transportChanged(),
    });
  }

  /** Connections follow the occupancy snapshot alone, so a seat needs nothing more. */
  async seated(): Promise<void> {}

  /** The mesh never opens a media session, so no media server signal is for it. */
  async handleMediaSignal(): Promise<void> {}

  mediaSessionClosed(): void {}

  /** Bring the connections in line with the hub's list of participants. */
  async reconcile(participants: readonly VoiceOccupant[]): Promise<void> {
    const session = this.deps.session();
    const seen = new Set<UserId>();

    for (const participant of participants) {
      if (participant.userId === this.deps.selfUserId) continue;
      seen.add(participant.userId);
      const existing = this.peers.get(participant.userId);
      if (existing) {
        existing.person.displayName = participant.displayName;
        existing.person.muted = participant.muted;
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
    this.people.delete(userId);
    this.deps.transportChanged();
    this.deps.remoteAudio.release(peer.person);
    const { link } = peer;
    link.candidates.close();
    link.watchdog.dispose();
    const { connection } = link;
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

  /**
   * Replace a connection that can no longer be trusted. The person stays in
   * the call but starts over with it: their sinks and the record of their
   * streams belonged to the old connection.
   */
  async rebuild(link: Link): Promise<void> {
    const peer = this.owners.get(link);
    if (!peer || this.peers.get(peer.person.userId) !== peer) return;
    const { person } = peer;
    const occupant: VoiceOccupant = {
      userId: person.userId,
      displayName: person.displayName,
      muted: person.muted,
    };
    this.drop(person.userId);
    try {
      await this.create(occupant);
    } catch {
      // Reconciliation or the recovery watchdog will retry this one peer.
    }
  }

  /** Offer again to every peer that is free to take one. */
  async renegotiate(): Promise<void> {
    await Promise.all(
      this.links()
        .filter((link) => link.connection.signalingState === "stable")
        .map((link) => this.negotiator.offer(link)),
    );
  }

  async applyMicEncoding(): Promise<void> {
    const bitrate = this.deps.bitrate();
    await Promise.all(
      this.links().map((link) =>
        link.micSender ? applyEncoding(link.micSender, bitrate) : undefined,
      ),
    );
  }

  repairUnhealthy(): Promise<void> {
    return this.health.repairUnhealthy();
  }

  links(): Link[] {
    return [...this.peers.values()].map(({ link }) => link);
  }

  transport(): TransportReport {
    return this.health.transport();
  }

  sample(): Promise<StatsRound> {
    return this.health.sample();
  }

  async handleSignal(signal: VoiceSignal): Promise<void> {
    const from = signal.fromUserId;
    if (!from || from === this.deps.selfUserId) return;
    const peer = this.peers.get(from);
    if (!peer) return;
    const { link } = peer;

    try {
      if (signal.kind === "candidate") {
        const candidate = decodeRtcCandidate(signal.payload);
        if (candidate !== undefined) await link.candidates.add(candidate);
      } else if (signal.kind === "offer" || signal.kind === "answer") {
        const description = decodeRtcDescription(signal.payload, signal.kind);
        if (description) await this.negotiator.receive(link, description);
      }
    } catch {
      // A single bad frame must not tear down the session.
    }
  }

  /** A remote track arrived on a peer's connection, so it is that person's. */
  private receiveTrack(peer: MeshPeer, event: RTCTrackEvent): void {
    const [stream] = event.streams;
    if (!stream) return;
    this.deps.receiveTrack(peer.person, event.track, stream);
  }

  private async create(participant: VoiceOccupant): Promise<void> {
    const { negotiator } = this;
    const peer = createPeer({
      user: participant,
      selfUserId: this.deps.selfUserId,
      iceServers: this.deps.ice.current(),
      // How this person sounded last time is how they start this time.
      preference: this.deps.preferences.get(participant.userId),
      createVoice: () => this.deps.remoteAudio.createVoice(),
      recovery: this.health.recovery,
    });
    const { link } = peer;
    const { connection } = link;
    this.owners.set(link, peer);
    this.peers.set(participant.userId, peer);
    this.people.set(participant.userId, peer.person);
    this.deps.transportChanged();

    this.deps.microphone.addTo(link);
    negotiator.tuneMicSender(link);
    // A person who arrives mid-share, or after the camera went on, sees it at once.
    this.deps.camera.addTo(link);
    this.deps.screen.addTo(link);

    connection.ontrack = (event) => this.receiveTrack(peer, event);
    connection.onicecandidate = (event) => {
      void this.deps.send({
        kind: "candidate",
        toUserId: participant.userId,
        payload: encodeRtcCandidate(event.candidate ? event.candidate.toJSON() : null),
      });
    };
    connection.onnegotiationneeded = () => {
      void negotiator.offer(link);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "closed") this.drop(participant.userId);
      else this.health.onConnectionState(link);
    };

    if (!link.polite) await negotiator.offer(link);
    this.deps.announceTo(participant.userId);
  }
}
