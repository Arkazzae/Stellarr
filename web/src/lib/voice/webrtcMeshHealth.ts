import type { Translator } from "@/i18n";
import type { UserId } from "@/lib/api/types";
import type { VoiceStateStore } from "./store";
import type { VoiceMediaState } from "./types";
import { peerLostError, peerStalledError } from "./webrtcErrors";
import { expectFreshMedia, isSilent, proveMediaFlow, readLink } from "./webrtcHealth";
import type { MeshPeer } from "./webrtcMesh";
import type { Link, LinkRecovery } from "./webrtcPeer";
import type { StatsRound, TransportReport } from "./webrtcTopology";

const DEFAULT_RECOVERY_GRACE_MS = 10_000;
const MAX_ICE_RESTARTS = 3;

export interface MeshHealthEnv {
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly store: VoiceStateStore;
  readonly peers: ReadonlyMap<UserId, MeshPeer>;
  /** Grace before a `disconnected` link is nudged with an ICE restart. */
  recoveryGraceMs?: number;
  /** The session in progress, or null between calls. */
  activeSession(): number | null;
  /** Make and send a fresh offer, e.g. to carry an ICE restart. Never rejects. */
  reoffer(link: Link): Promise<void>;
  /** What `transport()` reports may have changed. */
  transportChanged(): void;
}

/**
 * Whether each connection of the mesh really works, and getting it working
 * again.
 *
 * Every other person has a connection of their own, so the mesh can judge each
 * person by their link. ICE and DTLS saying "connected" proves nothing about
 * audio, so a link only counts once its cumulative RTP counters have moved in
 * both expected directions. A link that drops is nudged with at most three ICE
 * restarts, each given a grace window, before its person is reported lost.
 */
export class MeshHealth {
  /** Handed to every link, which arms the watchdog when its connection falters. */
  readonly recovery: LinkRecovery;

  constructor(private readonly env: MeshHealthEnv) {
    this.recovery = {
      graceMs: env.recoveryGraceMs ?? DEFAULT_RECOVERY_GRACE_MS,
      maxAttempts: MAX_ICE_RESTARTS,
      onEscalate: (link) => {
        void this.restartIce(link);
      },
      onExhausted: (link) => this.fail(link),
    };
  }

  /** The media state from what every link has proven; one link per person. */
  transport(): TransportReport {
    const all = [...this.env.peers.values()].map(({ link }) => link);
    const connected = all.filter((link) => link.connection.connectionState === "connected");
    const flowing = connected.filter((link) => link.flow.verified).length;
    const unusable = all.filter((link) => link.flow.recoveryFailed || isSilent(link)).length;

    let media: VoiceMediaState;
    if (all.length === 0) media = "ready";
    else if (flowing === all.length) media = "connected";
    else if (unusable === all.length) media = "failed";
    else if (flowing > 0 || unusable > 0) media = "degraded";
    else media = "connecting";

    return { media, peerCount: all.length, connectedPeerCount: connected.length };
  }

  /** React to a connection's state change, except `closed`, which drops the peer. */
  onConnectionState(link: Link): void {
    const state = link.connection.connectionState;

    if (state === "connected") {
      link.watchdog.disarm();
      link.flow.recoveryFailed = false;
      this.env.transportChanged();
    } else if (state === "disconnected") {
      // Transient by design: a Wi-Fi handover or a sleeping tab produces this
      // routinely and ICE usually recovers unaided. Wait before intervening.
      expectFreshMedia(link.flow);
      link.watchdog.arm();
      this.env.transportChanged();
    } else if (state === "failed") {
      expectFreshMedia(link.flow);
      // Once the budget is spent the watchdog owns the final grace window and
      // reports the peer lost, unless a connected event disarms it first.
      if (!link.watchdog.exhausted) {
        // A direct `connected -> failed` skips the disconnected branch that
        // normally arms the chain. Its immediate attempt still counts against
        // the same budget.
        link.watchdog.arm(true);
        this.env.transportChanged();
      }
    }
  }

  /** Restart ICE on every link that is down, leaving working ones alone. */
  async repairUnhealthy(): Promise<void> {
    await Promise.all(
      [...this.env.peers.values()].map(async ({ link }) => {
        const state = link.connection.connectionState;
        if (state === "failed" || state === "disconnected") await this.restartIce(link);
      }),
    );
  }

  /**
   * Read every link. Settling the round proves each person's link from it:
   * this side must be heard unless it is muted, and so must the person.
   */
  async sample(): Promise<StatsRound> {
    const peers = [...this.env.peers.values()];
    const readings = await Promise.all(peers.map(({ link }) => readLink(link)));
    return {
      readings,
      settle: (selfMuted) => {
        for (const [index, { person, link }] of peers.entries()) {
          if (link.connection.connectionState !== "connected") continue;
          proveMediaFlow(link.flow, readings[index]?.media ?? null, {
            selfMuted,
            remoteMuted: person.muted,
          });
        }
        this.env.transportChanged();
        this.reportStalled(peers);
      },
    };
  }

  private async restartIce(link: Link): Promise<void> {
    const { connection } = link;
    if (this.env.activeSession() === null || connection.connectionState === "closed") return;
    expectFreshMedia(link.flow);
    this.env.transportChanged();

    try {
      if (typeof connection.restartIce === "function") connection.restartIce();
    } catch {
      // Bounded by the watchdog; nothing further to try here.
    }
    // The impolite side owns the restart offer; the polite side would only
    // create glare with nothing to gain.
    if (!link.polite && connection.signalingState === "stable") {
      await this.env.reoffer(link);
    }
  }

  /** The last restart had its grace window too. A link that was dropped meanwhile is nobody's. */
  private fail(link: Link): void {
    const peer = [...this.env.peers.values()].find((candidate) => candidate.link === link);
    if (!peer) return;
    link.flow.recoveryFailed = true;
    this.env.transportChanged();
    this.env.store.set({ error: peerLostError(this.env.translate, peer.person.displayName) });
  }

  private reportStalled(peers: readonly MeshPeer[]): void {
    const { store, translate } = this.env;
    const stalled = peers.find(({ link }) => isSilent(link));
    if (stalled) {
      store.set({ error: peerStalledError(translate, stalled.person.displayName) });
    } else if (
      store.getSnapshot().transport.media === "connected" &&
      store.getSnapshot().error?.kind === "transport"
    ) {
      store.set({ error: null });
    }
  }
}
