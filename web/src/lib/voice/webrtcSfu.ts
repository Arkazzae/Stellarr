import type { Translator } from "@/i18n";
import type { ChannelId, UserId, VoiceOccupant } from "@/lib/api/types";
import type {
  MediaSessionClosedEvent,
  MediaSignal,
  RealtimeClient,
} from "@/lib/realtime/types";
import {
  decodeMediaServerAnswer,
  decodeMediaServerOffer,
  decodeMediaTracks,
  encodeBrowserAnswer,
  encodeBrowserOffer,
  encodeMediaCandidate,
  RTC_PROTOCOL_VERSION,
  type BrowserMediaSignalKind,
  type MediaServerSignalKind,
} from "@/lib/rtc/protocol";
import type { VoiceIceProvider } from "./iceSession";
import type { ParticipantPreferencesStore } from "./participantPreferences";
import type { VoiceSettings } from "./settings";
import type { VoiceStateStore } from "./store";
import { mediaServerLostError } from "./webrtcErrors";
import { expectFreshMedia, readLink } from "./webrtcHealth";
import type { LocalCamera, LocalScreen } from "./webrtcLocalVideo";
import type { LocalMicrophone } from "./webrtcMicrophone";
import {
  createParticipant,
  type Participant,
  type ParticipantMediaEnv,
} from "./webrtcParticipant";
import {
  applyEncoding,
  createLink,
  Negotiator,
  type AudioSectionUse,
  type Link,
  type LinkRecovery,
} from "./webrtcPeer";
import type { RemoteAudio } from "./webrtcRemoteAudio";
import { TrackDirectory } from "./webrtcSfuDirectory";
import { SfuHealth } from "./webrtcSfuHealth";
import type { CallTopology, StatsRound, TransportReport } from "./webrtcTopology";

const DEFAULT_RECOVERY_GRACE_MS = 10_000;
/**
 * 2 s, 4 s, then 8 s. The API polls a media server that went away every 2 s,
 * so the three attempts span a restart of the media server process rather
 * than being spent before the API has noticed it is back.
 */
const DEFAULT_REPLACEMENT_PAUSE_MS = 2_000;
/** Replacements in a row before the call is given up; a replacement that proves media resets it. */
const MAX_REPLACEMENTS = 3;

export interface SfuDeps {
  readonly selfUserId: UserId;
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly store: VoiceStateStore;
  readonly realtime: Pick<RealtimeClient, "openMediaSession" | "sendMediaSignal" | "getStatus">;
  readonly ice: VoiceIceProvider;
  readonly preferences: ParticipantPreferencesStore;
  readonly remoteAudio: RemoteAudio;
  /** Files a person's tracks: their sinks, streams and tiles. */
  readonly personMedia: ParticipantMediaEnv;
  readonly microphone: LocalMicrophone;
  readonly camera: LocalCamera;
  readonly screen: LocalScreen;
  /** Grace before a `disconnected` connection is replaced. */
  recoveryGraceMs?: number;
  /** Pause before the first replacement in a row; each further one waits twice as long. */
  replacementPauseMs?: number;
  settings(): VoiceSettings;
  /** The send ceiling the adaptive controller currently allows. */
  bitrate(): number;
  /** Whether the shared sound being sent has two channels. */
  screenAudioStereo(): boolean;
  /** The room this side is seated in, or null between calls. */
  channelId(): ChannelId | null;
  /** Tell one person where this side stands, which they may have missed. */
  announceTo(userId: UserId): void;
  /** The session in progress, or null between calls. */
  activeSession(): number | null;
  /** What a person publishes to the UI has changed. */
  changed(): void;
  /** What `transport()` reports may have changed. */
  transportChanged(): void;
}

/** One media session of the seat, and the one connection that belongs to it. */
interface MediaSessionLink {
  readonly id: string;
  readonly channelId: ChannelId;
  readonly link: Link;
  readonly directory: TrackDirectory;
  /**
   * Every step of the negotiation, strictly in order: the media server's
   * signals as they arrived and this side's own offers.
   */
  chain: Promise<void>;
  /** Signals to the hub, one at a time, in the order they were made. */
  outbox: Promise<void>;
  /** What this side publishes changed since its last offer. */
  wantsOffer: boolean;
  /** The number of the media server offer being answered, echoed in the answer. */
  answering: number | null;
  closed: boolean;
}

/**
 * The `sfu` topology: one connection to Stellarr Media, which forwards
 * everybody else's tracks on it (the "Client rules" of
 * docs/STELLARR_MEDIA.md).
 *
 * The connection belongs to a media session that the hub opens for this
 * seat. The browser offers what it publishes and answers what the media
 * server offers; it is the impolite side, so a media server offer that meets
 * one of its own is ignored, and the media server offers again. A directory
 * that comes with the media server's signals says whose track arrives on
 * which section (`webrtcSfuDirectory`). A connection that dies is not
 * repaired but replaced by a new session, at most three times in a row.
 */
export class Sfu implements CallTopology {
  private session: MediaSessionLink | null = null;
  private readonly negotiator: Negotiator;
  private readonly health: SfuHealth;
  private readonly recovery: LinkRecovery;
  /** Bumped whenever what is being opened stops mattering: a leave, a move, a newer attempt. */
  private generation = 0;
  /** Replacements in a row without proven media. */
  private attempts = 0;
  private exhausted = false;
  /** A connection was lost while the hub was away; the rejoin opens the next one. */
  private waitingForHub = false;
  private replacementTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Everyone else in the call, shared with the client that shows and plays them. */
    private readonly people: Map<UserId, Participant>,
    private readonly deps: SfuDeps,
  ) {
    this.negotiator = new Negotiator({
      settings: () => deps.settings(),
      bitrate: () => deps.bitrate(),
      screenAudioStereo: () => deps.screenAudioStereo(),
      send: (link, type, sdp) => this.sendDescription(link, type, sdp),
      // The directory, not the description, says what each section carries.
      remoteMediaLearned: () => undefined,
      audioUse: (link, section) => this.audioUse(link, section),
    });
    this.health = new SfuHealth({
      translate: deps.translate,
      store: deps.store,
      people,
    });
    this.recovery = {
      graceMs: deps.recoveryGraceMs ?? DEFAULT_RECOVERY_GRACE_MS,
      // The watchdog only says when; the replacement is the whole repair.
      maxAttempts: 1,
      onEscalate: (link) => {
        // After the watchdog has scheduled what follows, so closing the link
        // cancels that too.
        void Promise.resolve().then(() => {
          if (this.session?.link === link) this.replace();
        });
      },
      onExhausted: () => undefined,
    };
  }

  // ------------------------------------------------------------- the seat

  /** Every confirmed seat gets a session of its own and a fresh budget. */
  async seated(): Promise<void> {
    this.cancelReplacement();
    this.attempts = 0;
    this.exhausted = false;
    this.waitingForHub = false;
    await this.open();
  }

  async reconcile(participants: readonly VoiceOccupant[]): Promise<void> {
    const seen = new Set<UserId>();
    const arrived: UserId[] = [];

    for (const participant of participants) {
      if (participant.userId === this.deps.selfUserId) continue;
      seen.add(participant.userId);
      const existing = this.people.get(participant.userId);
      if (existing) {
        existing.displayName = participant.displayName;
        existing.muted = participant.muted;
        continue;
      }
      this.people.set(
        participant.userId,
        createParticipant({
          user: participant,
          // How this person sounded last time is how they start this time.
          preference: this.deps.preferences.get(participant.userId),
          createVoice: () => this.deps.remoteAudio.createVoice(),
        }),
      );
      arrived.push(participant.userId);
    }

    const left: Participant[] = [];
    for (const [userId, person] of [...this.people]) {
      if (seen.has(userId)) continue;
      this.people.delete(userId);
      left.push(person);
    }

    // Whoever just arrived gets what was held for them, and whoever left
    // stops playing, before their sinks go.
    this.session?.directory.place();
    for (const person of left) this.deps.remoteAudio.release(person);
    // A newcomer cannot tell this side's camera from its screen without it.
    for (const userId of arrived) this.deps.announceTo(userId);

    this.deps.transportChanged();
    this.deps.changed();
  }

  /** The hub refuses `offer`, `answer` and `candidate` on `VoiceSignal` in this topology. */
  async handleSignal(): Promise<void> {}

  handleMediaSignal(signal: MediaSignal<MediaServerSignalKind>): Promise<void> {
    const session = this.session;
    // A signal of an earlier session, or of the room before a move, is stale.
    if (!session || signal.sessionId !== session.id || signal.channelId !== session.channelId) {
      return Promise.resolve();
    }
    return this.enqueue(session, () => this.apply(session, signal));
  }

  mediaSessionClosed(event: MediaSessionClosedEvent): void {
    const session = this.session;
    if (!session || event.sessionId !== session.id || event.channelId !== session.channelId) return;
    this.replace();
  }

  // ------------------------------------------------------- what is published

  renegotiate(): Promise<void> {
    const session = this.session;
    return session ? this.requestOffer(session) : Promise.resolve();
  }

  async applyMicEncoding(): Promise<void> {
    const sender = this.session?.link.micSender;
    if (sender) await applyEncoding(sender, this.deps.bitrate());
  }

  links(): Link[] {
    return this.session ? [this.session.link] : [];
  }

  // ------------------------------------------------------------- recovery

  dropAll(): void {
    this.generation += 1;
    this.cancelReplacement();
    this.closeSession();
    this.attempts = 0;
    this.exhausted = false;
    this.waitingForHub = false;
    for (const [userId, person] of [...this.people]) {
      this.people.delete(userId);
      this.deps.remoteAudio.release(person);
    }
    this.deps.transportChanged();
  }

  /**
   * Only a connection that is down is replaced. A tab that comes back to a
   * working one leaves it alone; rebuilding it would cause the very glitch
   * this is meant to avoid.
   */
  async repairUnhealthy(): Promise<void> {
    const state = this.session?.link.connection.connectionState;
    if (state === "failed" || state === "disconnected") this.replace();
  }

  async rebuild(link: Link): Promise<void> {
    if (this.session?.link === link) this.replace();
  }

  transport(): TransportReport {
    return this.health.transport(this.condition());
  }

  async sample(): Promise<StatsRound> {
    const session = this.session;
    if (!session) {
      return {
        readings: [],
        settle: () => {
          this.deps.transportChanged();
          this.health.report(this.condition());
        },
      };
    }
    const reading = await readLink(session.link);
    return {
      readings: [reading],
      settle: (selfMuted) => {
        if (this.session !== session) return;
        this.health.settle(session.link, reading, selfMuted, (person) =>
          session.directory.microphoneMids(person),
        );
        // A connection that proves media ends the run of replacements.
        if (session.link.flow.verified) this.attempts = 0;
        this.deps.transportChanged();
        this.health.report(this.condition());
      },
    };
  }

  // -------------------------------------------------------------- sessions

  /**
   * Open a media session for the seat and build its connection: the bootstrap
   * ICE servers, BUNDLE, everything this side publishes, then the offer.
   * Opening a session always means a new connection; the hub closes the
   * session this connection had before.
   */
  private async open(): Promise<void> {
    const channelId = this.deps.channelId();
    if (channelId === null || this.deps.activeSession() === null) return;
    const generation = ++this.generation;
    this.closeSession();
    this.deps.transportChanged();

    let sessionId: string;
    try {
      sessionId = await this.deps.realtime.openMediaSession(channelId);
    } catch {
      // The media server could not be reached, or the seat moved on.
      if (generation === this.generation) this.replace();
      return;
    }
    if (generation !== this.generation || this.deps.channelId() !== channelId) return;

    let session: MediaSessionLink;
    try {
      session = this.build(sessionId, channelId);
    } catch {
      // The browser would not even make the connection; another attempt is
      // all there is to try.
      this.replace();
      return;
    }
    this.deps.transportChanged();
    await this.requestOffer(session);
  }

  private build(id: string, channelId: ChannelId): MediaSessionLink {
    const link = createLink({
      // Read now, not at join: a replacement late in a long call must not
      // reach for credentials that have expired.
      iceServers: this.deps.ice.current(),
      // The media server yields when both offer at once.
      polite: false,
      sendOnly: true,
      recovery: this.recovery,
    });
    const session: MediaSessionLink = {
      id,
      channelId,
      link,
      directory: new TrackDirectory({
        people: this.people,
        personMedia: this.deps.personMedia,
        remoteAudio: this.deps.remoteAudio,
      }),
      chain: Promise.resolve(),
      outbox: Promise.resolve(),
      wantsOffer: false,
      answering: null,
      closed: false,
    };
    this.session = session;

    const { connection } = link;
    connection.ontrack = (event) => {
      if (this.session === session) session.directory.arrive(event.transceiver?.mid ?? null, event.track);
    };
    connection.onicecandidate = (event) => {
      void this.post(
        session,
        "candidate",
        encodeMediaCandidate(event.candidate ? event.candidate.toJSON() : null),
        false,
      );
    };
    connection.onnegotiationneeded = () => {
      if (this.session === session) void this.requestOffer(session);
    };
    connection.onconnectionstatechange = () => this.connectionChanged(session);

    // The captures outlive any one connection; a new one carries them all.
    this.deps.microphone.addTo(link);
    this.negotiator.tuneMicSender(link);
    this.deps.camera.addTo(link);
    this.deps.screen.addTo(link);
    if (!link.micSender && !link.cameraSender && !link.screenVideoSender) {
      // An offer must have a section, and the media server offers nothing
      // before it has answered one.
      connection.addTransceiver("audio", { direction: "recvonly" });
    }
    return session;
  }

  /** Close the current connection. People stay; only what arrived on it goes. */
  private closeSession(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.closed = true;
    session.directory.clear();
    this.health.forget();

    const { link } = session;
    link.candidates.close();
    link.watchdog.dispose();
    const { connection } = link;
    connection.ontrack = null;
    connection.onicecandidate = null;
    connection.onnegotiationneeded = null;
    connection.onconnectionstatechange = null;
    try {
      connection.close();
    } catch {
      // Already closed.
    }
  }

  /**
   * The connection is lost: close it now, so nothing of it plays, and open a
   * new session after a pause that doubles each time. The captures stay open.
   */
  private replace(): void {
    if (this.deps.activeSession() === null) return;
    this.generation += 1;
    this.closeSession();

    if (this.replacementTimer === null && !this.exhausted) {
      if (this.deps.realtime.getStatus() !== "connected") {
        // The hub is away, and its reconnect ends the seat and the session
        // anyway; the rejoin opens the next one without spending the budget.
        this.waitingForHub = true;
      } else if (this.attempts >= MAX_REPLACEMENTS) {
        this.fail();
      } else {
        this.attempts += 1;
        const pause =
          (this.deps.replacementPauseMs ?? DEFAULT_REPLACEMENT_PAUSE_MS) * 2 ** (this.attempts - 1);
        this.replacementTimer = setTimeout(() => {
          this.replacementTimer = null;
          void this.open();
        }, pause);
      }
    }
    this.deps.transportChanged();
  }

  private fail(): void {
    this.exhausted = true;
    this.deps.store.set({ error: mediaServerLostError(this.deps.translate) });
  }

  private cancelReplacement(): void {
    if (this.replacementTimer === null) return;
    clearTimeout(this.replacementTimer);
    this.replacementTimer = null;
  }

  private connectionChanged(session: MediaSessionLink): void {
    if (this.session !== session) return;
    const { link } = session;
    const state = link.connection.connectionState;

    if (state === "connected") {
      link.watchdog.disarm();
    } else if (state === "disconnected") {
      // Transient by design: a Wi-Fi handover produces this routinely and ICE
      // usually recovers unaided. The watchdog replaces it after the grace.
      expectFreshMedia(link.flow);
      link.watchdog.arm();
    } else if (state === "failed" || state === "closed") {
      this.replace();
      return;
    }
    this.deps.transportChanged();
  }

  private condition() {
    return {
      link: this.session?.link ?? null,
      recovering: this.attempts > 0 || this.replacementTimer !== null || this.waitingForHub,
      exhausted: this.exhausted,
    };
  }

  // ----------------------------------------------------------- negotiation

  /** Run `step` after everything already queued on the session's negotiation. */
  private enqueue(session: MediaSessionLink, step: () => Promise<void>): Promise<void> {
    const run = session.chain.then(() => (session.closed ? undefined : step()));
    session.chain = run.catch(() => undefined);
    return session.chain;
  }

  /**
   * Ask for an offer of what this side publishes. Requests made while an
   * offer is unanswered are not lost: the offer is made once the answer lands.
   */
  private requestOffer(session: MediaSessionLink): Promise<void> {
    session.wantsOffer = true;
    return this.enqueue(session, () => this.offerIfWanted(session));
  }

  private async offerIfWanted(session: MediaSessionLink): Promise<void> {
    const { link } = session;
    if (!session.wantsOffer || link.connection.signalingState !== "stable") return;
    session.wantsOffer = false;
    await this.negotiator.offer(link);
    // `offer` never rejects. A connection that could not even describe itself
    // would never publish again.
    if (!session.closed && link.connection.signalingState === "stable") this.lose(session);
  }

  private async apply(
    session: MediaSessionLink,
    signal: MediaSignal<MediaServerSignalKind>,
  ): Promise<void> {
    const { link } = session;
    const { connection } = link;

    if (signal.kind === "offer") {
      const offer = decodeMediaServerOffer(signal.payload);
      if (!offer) return;
      // Impolite: an offer that meets one of ours being made or unanswered is
      // ignored, directory and all. The media server rolls it back, answers
      // ours and offers again.
      if (link.makingOffer || connection.signalingState !== "stable") return;
      // In hand before the description is applied, so every track the offer
      // brings finds its section named.
      session.directory.update(offer.tracks);
      session.answering = offer.negotiationId;
      try {
        await this.negotiator.receive(link, { type: "offer", sdp: offer.sdp });
      } catch {
        // A description the browser refuses leaves the two sides apart for
        // good. Waiting for the media server's third strike only adds silence.
        this.lose(session);
        return;
      } finally {
        session.answering = null;
      }
    } else if (signal.kind === "answer") {
      const answer = decodeMediaServerAnswer(signal.payload);
      // Nothing of ours is waiting for it: a late answer.
      if (!answer || connection.signalingState !== "have-local-offer") return;
      try {
        await this.negotiator.receive(link, answer);
      } catch {
        this.lose(session);
        return;
      }
    } else {
      const tracks = decodeMediaTracks(signal.payload);
      if (tracks) session.directory.update(tracks);
    }

    if (session.wantsOffer) await this.offerIfWanted(session);
  }

  /** The negotiator finished a description: hand it to the media server. */
  private async sendDescription(link: Link, type: "offer" | "answer", sdp: string): Promise<void> {
    const session = this.session;
    if (!session || session.link !== link) return;
    if (type === "offer") {
      await this.post(session, "offer", encodeBrowserOffer(sdp), true);
      return;
    }
    // Read before the first await: the number belongs to the offer being answered now.
    const negotiationId = session.answering;
    if (negotiationId === null) return;
    await this.post(session, "answer", encodeBrowserAnswer(sdp, negotiationId), true);
  }

  /**
   * Send one signal after every signal made before it. A description the hub
   * refuses leaves this side waiting for an answer that never comes, so that
   * session is replaced; a lost candidate costs nothing, since the media
   * server learns this side's address from its checks.
   */
  private async post(
    session: MediaSessionLink,
    kind: BrowserMediaSignalKind,
    payload: string,
    vital: boolean,
  ): Promise<void> {
    const signal: MediaSignal<BrowserMediaSignalKind> = {
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: session.channelId,
      sessionId: session.id,
      kind,
      payload,
    };
    const sent = session.outbox.then(() =>
      session.closed ? undefined : this.deps.realtime.sendMediaSignal(signal),
    );
    session.outbox = sent.catch(() => undefined);
    try {
      await sent;
    } catch {
      if (vital) this.lose(session);
    }
  }

  /** Replace `session` if it is still the current one. */
  private lose(session: MediaSessionLink): void {
    if (this.session === session) this.replace();
  }

  /**
   * What an audio section carries, for the Opus parameters of this side's
   * descriptions: the media server repeats a publisher's own parameters back
   * to it, so they set this side's encoders, and the parameters of a section
   * it receives set its decoder.
   */
  private audioUse(
    link: Link,
    { mid, streamId }: { mid: string | null; streamId: string | null },
  ): AudioSectionUse | null {
    const session = this.session;
    if (!session || session.link !== link) return null;
    const received = mid === null ? null : session.directory.useOf(mid);
    if (received) return received;
    if (streamId === null) return null;
    if (streamId === this.deps.screen.streamId) return "shared-sound";
    if (streamId === this.deps.microphone.capture?.stream.id) return "speech";
    return null;
  }
}
