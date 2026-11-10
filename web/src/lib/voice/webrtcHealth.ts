import type { Translator } from "@/i18n";
import type { UserId } from "@/lib/api/types";
import type { RealtimeClient } from "@/lib/realtime/types";
import { classify, type AdaptiveBitrateController, type NetworkSample } from "./bitrate";
import { TURN_SAFETY_MARGIN_MS, turnCredentialExpiry, type VoiceIceProvider } from "./iceSession";
import {
  summariseMediaCounters,
  summariseStats,
  worstSample,
  type MediaCounters,
} from "./stats";
import type { VoiceStateStore } from "./store";
import type { VoiceMediaState } from "./types";
import {
  iceRefreshFailedError,
  iceRefreshPartialError,
  peerLostError,
  peerStalledError,
} from "./webrtcErrors";
import type { MediaFlow, Peer, PeerRecovery } from "./webrtcPeer";

const DEFAULT_STATS_INTERVAL_MS = 3000;
const DEFAULT_RECOVERY_GRACE_MS = 10_000;
const MAX_ICE_RESTARTS = 3;
const ICE_REFRESH_RETRY_MS = 30_000;
/** Samples a connected peer may go without RTP proof before it counts as silent. */
const SILENT_SAMPLE_LIMIT = 3;
// Browsers and Node clamp larger timeouts to roughly 24.8 days. Rescheduling a
// checkpoint avoids turning a far-future static credential into a 1 ms loop.
const MAX_TIMEOUT_MS = 2_000_000_000;

export interface CallHealthEnv {
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly realtime: Pick<RealtimeClient, "getRtcClock">;
  readonly ice: VoiceIceProvider;
  readonly store: VoiceStateStore;
  readonly peers: ReadonlyMap<UserId, Peer>;
  readonly bitrate: AdaptiveBitrateController;
  /** Stats cadence. Observational only: media never depends on it. */
  statsIntervalMs?: number;
  /** Grace before a `disconnected` peer is nudged with an ICE restart. */
  recoveryGraceMs?: number;
  /** The session in progress, or null between calls. */
  activeSession(): number | null;
  /** Make and send a fresh offer, e.g. to carry an ICE restart. Never rejects. */
  reoffer(peer: Peer): Promise<void>;
  /** Push the controller's current ceiling to every microphone sender. */
  applyMicEncoding(): Promise<void>;
}

interface Reading {
  peer: Peer;
  network: NetworkSample | null;
  media: MediaCounters | null;
}

/**
 * Whether the call is really working, and getting it working again.
 *
 * ICE and DTLS saying "connected" proves nothing about audio, so a peer only
 * counts once its cumulative RTP counters have moved in both expected
 * directions. A peer that drops is nudged with at most three ICE restarts,
 * each given a grace window, before it is reported lost. TURN credentials are
 * swapped in before they expire.
 */
export class CallHealth {
  /** Handed to every peer, which arms the watchdog when its connection falters. */
  readonly recovery: PeerRecovery;

  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly env: CallHealthEnv) {
    this.recovery = {
      graceMs: env.recoveryGraceMs ?? DEFAULT_RECOVERY_GRACE_MS,
      maxAttempts: MAX_ICE_RESTARTS,
      onEscalate: (peer) => {
        void this.restartIce(peer);
      },
      onExhausted: (peer) => this.failPeer(peer),
    };
  }

  // ------------------------------------------------------------- transport

  /** Recompute the media state the dock shows from what every peer has proven. */
  syncTransport(): void {
    const { store, peers } = this.env;
    const current = store.getSnapshot().transport;
    if (this.env.activeSession() === null) {
      store.set({
        transport: {
          signaling: current.signaling,
          media: "idle",
          peerCount: 0,
          connectedPeerCount: 0,
        },
      });
      return;
    }

    const all = [...peers.values()];
    const connected = all.filter((peer) => peer.connection.connectionState === "connected");
    const flowing = connected.filter((peer) => peer.flow.verified).length;
    const unusable = all.filter(
      (peer) => peer.flow.recoveryFailed || isSilent(peer),
    ).length;

    let media: VoiceMediaState;
    if (all.length === 0) media = "ready";
    else if (flowing === all.length) media = "connected";
    else if (unusable === all.length) media = "failed";
    else if (flowing > 0 || unusable > 0) media = "degraded";
    else media = "connecting";

    store.set({
      transport: {
        ...current,
        media,
        peerCount: all.length,
        connectedPeerCount: connected.length,
      },
    });
  }

  /** React to a peer connection's state change, except `closed`, which drops the peer. */
  onConnectionState(peer: Peer): void {
    const state = peer.connection.connectionState;

    if (state === "connected") {
      peer.watchdog.disarm();
      peer.flow.recoveryFailed = false;
      this.syncTransport();
    } else if (state === "disconnected") {
      // Transient by design: a Wi-Fi handover or a sleeping tab produces this
      // routinely and ICE usually recovers unaided. Wait before intervening.
      expectFreshMedia(peer.flow);
      peer.watchdog.arm();
      this.syncTransport();
    } else if (state === "failed") {
      expectFreshMedia(peer.flow);
      // Once the budget is spent the watchdog owns the final grace window and
      // reports the peer lost, unless a connected event disarms it first.
      if (!peer.watchdog.exhausted) {
        // A direct `connected -> failed` skips the disconnected branch that
        // normally arms the chain. Its immediate attempt still counts against
        // the same budget.
        peer.watchdog.arm(true);
        this.syncTransport();
      }
    }
  }

  /** Restart ICE on every peer that is down, leaving working ones alone. */
  async repairUnhealthy(): Promise<void> {
    await Promise.all(
      [...this.env.peers.values()].map(async (peer) => {
        const state = peer.connection.connectionState;
        if (state === "failed" || state === "disconnected") await this.restartIce(peer);
      }),
    );
  }

  private async restartIce(peer: Peer): Promise<void> {
    const { connection } = peer;
    if (this.env.activeSession() === null || connection.connectionState === "closed") return;
    expectFreshMedia(peer.flow);
    this.syncTransport();

    try {
      if (typeof connection.restartIce === "function") connection.restartIce();
    } catch {
      // Bounded by the watchdog; nothing further to try here.
    }
    // The impolite side owns the restart offer; the polite side would only
    // create glare with nothing to gain.
    if (!peer.polite && connection.signalingState === "stable") {
      await this.env.reoffer(peer);
    }
  }

  private failPeer(peer: Peer): void {
    if (this.env.peers.get(peer.userId) !== peer) return;
    peer.flow.recoveryFailed = true;
    this.syncTransport();
    this.env.store.set({ error: peerLostError(this.env.translate, peer.displayName) });
  }

  // ----------------------------------------------------------------- stats

  startStats(): void {
    this.stopStats();
    this.statsTimer = setInterval(() => {
      void this.sample();
    }, this.env.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS);
  }

  /**
   * One round of observation. If it never runs, say because a hidden tab
   * throttles timers, media continues exactly as before; the ceiling simply
   * stops moving.
   */
  async sample(): Promise<void> {
    const session = this.env.activeSession();
    if (session === null) return;
    const { store } = this.env;

    const [readings, signalingRttMs] = await Promise.all([
      Promise.all([...this.env.peers.values()].map((peer) => this.read(peer))),
      this.measureSignalingRtt(),
    ]);
    if (this.env.activeSession() !== session) return;

    const totals = { bytesSent: 0, bytesReceived: 0, packetsSent: 0, packetsReceived: 0 };
    const selfMuted = store.getSnapshot().muted;
    for (const { peer, media } of readings) {
      if (media) {
        totals.bytesSent += media.bytesSent;
        totals.bytesReceived += media.bytesReceived;
        totals.packetsSent += media.packetsSent;
        totals.packetsReceived += media.packetsReceived;
      }
      if (peer.connection.connectionState === "connected") {
        proveMediaFlow(peer, media, selfMuted);
      }
    }

    this.syncTransport();
    this.reportStalledPeer(readings.map(({ peer }) => peer));
    await this.publishDiagnostics(readings, totals, signalingRttMs);
  }

  private async read(peer: Peer): Promise<Reading> {
    try {
      const report = await peer.connection.getStats();
      return {
        peer,
        network: summariseStats(report),
        media: summariseMediaCounters(report),
      };
    } catch {
      return { peer, network: null, media: null };
    }
  }

  private reportStalledPeer(peers: readonly Peer[]): void {
    const { store, translate } = this.env;
    const stalled = peers.find((peer) => isSilent(peer));
    if (stalled) {
      store.set({ error: peerStalledError(translate, stalled.displayName) });
    } else if (
      store.getSnapshot().transport.media === "connected" &&
      store.getSnapshot().error?.kind === "transport"
    ) {
      store.set({ error: null });
    }
  }

  private async publishDiagnostics(
    readings: readonly Reading[],
    totals: MediaCounters,
    signalingRttMs: number | null,
  ): Promise<void> {
    const { store, bitrate } = this.env;
    const previous = store.getSnapshot().diagnostics;
    const worst = worstSample(readings.flatMap(({ network }) => (network ? [network] : [])));

    if (!worst) {
      // Before a peer reports end-to-end timing, the signalling round trip
      // keeps the dock informative.
      const rttMs = signalingRttMs;
      store.set({
        diagnostics:
          rttMs === null
            ? { ...previous, ...totals }
            : {
                ...previous,
                quality: classify({ lossFraction: 0, rttMs }),
                lossFraction: null,
                rttMs,
                ...totals,
              },
      });
      return;
    }

    const decision = bitrate.observe(worst);
    store.set({
      diagnostics: {
        // The controller confirms a tier over several samples to keep the
        // encoder from oscillating. The readout can be honest immediately.
        quality: decision.quality === "unknown" ? classify(worst) : decision.quality,
        bitrate: decision.bitrate,
        lossFraction: worst.lossFraction,
        rttMs: worst.rttMs,
        ...totals,
      },
    });
    if (decision.changed) await this.env.applyMicEncoding();
  }

  private async measureSignalingRtt(): Promise<number | null> {
    const startedAt = performance.now();
    try {
      await this.env.realtime.getRtcClock();
      return Math.max(0, performance.now() - startedAt);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ ICE lifetime

  /** Schedule the swap of TURN credentials shortly before the first one expires. */
  scheduleIceRefresh(session: number, servers: readonly RTCIceServer[]): void {
    this.stopIceRefresh();
    if (this.env.activeSession() !== session) return;

    const expiries = servers
      .map((server) => turnCredentialExpiry(server.username))
      .filter((expiry): expiry is number => expiry !== null);
    if (expiries.length === 0) return;

    const refreshAt = Math.min(...expiries) - TURN_SAFETY_MARGIN_MS;
    const remaining = Math.max(1_000, refreshAt - Date.now());
    this.refreshTimer = setTimeout(
      () => {
        this.refreshTimer = null;
        if (remaining > MAX_TIMEOUT_MS) this.scheduleIceRefresh(session, servers);
        else void this.refreshIce(session);
      },
      Math.min(remaining, MAX_TIMEOUT_MS),
    );
  }

  /**
   * Fetch fresh ICE servers and give them to every connection.
   *
   * New credentials are for the next gathering phase, so a healthy path keeps
   * running and is not torn up once an hour. A peer that is already down can
   * use the fresh list immediately.
   */
  async refreshIce(session: number): Promise<void> {
    if (this.env.activeSession() !== session) return;
    const { store } = this.env;

    let servers: RTCIceServer[];
    try {
      servers = await this.env.ice.beginSession();
    } catch {
      if (this.env.activeSession() !== session) return;
      store.set({ error: iceRefreshFailedError(this.env.translate) });
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        void this.refreshIce(session);
      }, ICE_REFRESH_RETRY_MS);
      return;
    }
    if (this.env.activeSession() !== session) return;

    let appliedToEveryPeer = true;
    for (const peer of this.env.peers.values()) {
      try {
        const { connection } = peer;
        connection.setConfiguration({ ...connection.getConfiguration(), iceServers: servers });
        const state = connection.connectionState;
        if (state === "failed" || state === "disconnected") peer.watchdog.arm(state === "failed");
      } catch {
        appliedToEveryPeer = false;
      }
    }

    if (!appliedToEveryPeer) {
      store.set({ error: iceRefreshPartialError(this.env.translate) });
    } else if (store.getSnapshot().error?.kind === "ice-config") {
      store.set({ error: null });
    }
    this.scheduleIceRefresh(session, servers);
  }

  /** Cancel the sampling and the pending credential refresh. */
  stop(): void {
    this.stopStats();
    this.stopIceRefresh();
  }

  private stopStats(): void {
    if (this.statsTimer === null) return;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private stopIceRefresh(): void {
    if (this.refreshTimer === null) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}

/** Connected for a while, yet no audio has been proven to cross. */
function isSilent(peer: Peer): boolean {
  return (
    peer.connection.connectionState === "connected" &&
    !peer.flow.verified &&
    peer.flow.silentSamples >= SILENT_SAMPLE_LIMIT
  );
}

/** After an outage the old counters prove nothing; they have to move again. */
function expectFreshMedia(flow: MediaFlow): void {
  flow.verified = false;
  flow.silentSamples = 0;
  flow.requireFresh = true;
}

/**
 * Both directions must have carried audio, except that a muted side is not
 * expected to send. After an outage the counters must advance, not merely
 * be positive.
 */
function proveMediaFlow(peer: Peer, media: MediaCounters | null, selfMuted: boolean): void {
  const { flow } = peer;
  const sentCounter = media ? media.packetsSent + media.bytesSent : 0;
  const receivedCounter = media ? media.packetsReceived + media.bytesReceived : 0;
  const sent = flow.requireFresh
    ? counterAdvanced(sentCounter, flow.lastSent)
    : sentCounter > 0;
  const received = flow.requireFresh
    ? counterAdvanced(receivedCounter, flow.lastReceived)
    : receivedCounter > 0;
  flow.lastSent = sentCounter;
  flow.lastReceived = receivedCounter;

  const outbound = selfMuted || sent;
  const inbound = peer.muted || received;
  if ((sent || received) && outbound && inbound) {
    flow.verified = true;
    flow.silentSamples = 0;
    flow.requireFresh = false;
  } else if (!flow.verified) {
    flow.silentSamples += 1;
  }
}

/** A counter can drop only when the browser replaced or reset its RTP report. */
function counterAdvanced(next: number, previous: number): boolean {
  return next > previous || (next > 0 && next < previous);
}
