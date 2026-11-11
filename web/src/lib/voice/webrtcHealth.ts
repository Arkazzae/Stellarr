import type { Translator } from "@/i18n";
import type { RealtimeClient } from "@/lib/realtime/types";
import { classify, type AdaptiveBitrateController } from "./bitrate";
import { TURN_SAFETY_MARGIN_MS, turnCredentialExpiry, type VoiceIceProvider } from "./iceSession";
import {
  summariseMediaCounters,
  summariseStats,
  worstSample,
  type MediaCounters,
} from "./stats";
import type { VoiceStateStore } from "./store";
import { iceRefreshFailedError, iceRefreshPartialError } from "./webrtcErrors";
import type { Link, MediaFlow } from "./webrtcPeer";
import type { CallTopology, LinkReading } from "./webrtcTopology";

const DEFAULT_STATS_INTERVAL_MS = 3000;
const ICE_REFRESH_RETRY_MS = 30_000;
/** Samples a connected link may go without RTP proof before it counts as silent. */
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
  readonly bitrate: AdaptiveBitrateController;
  /** Stats cadence. Observational only: media never depends on it. */
  statsIntervalMs?: number;
  /** The session in progress, or null between calls. */
  activeSession(): number | null;
  /** How the call is connected. Asked every time, never kept. */
  topology(): Pick<CallTopology, "links" | "transport" | "sample" | "applyMicEncoding">;
}

/**
 * What the dock says about the call, and the clocks that keep the call
 * working, whatever its topology.
 *
 * The topology decides what counts as working: which links there are, when
 * media is proven, and how a broken link is repaired. This class publishes
 * what it reports, samples it on a timer, turns the samples into diagnostics
 * and the adaptive bitrate, and swaps TURN credentials in before they expire.
 */
export class CallHealth {
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly env: CallHealthEnv) {}

  // ------------------------------------------------------------- transport

  /** Publish the media state the topology reports, or idle between calls. */
  syncTransport(): void {
    const { store } = this.env;
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

    const { media, peerCount, connectedPeerCount } = this.env.topology().transport();
    store.set({ transport: { ...current, media, peerCount, connectedPeerCount } });
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

    const [round, signalingRttMs] = await Promise.all([
      this.env.topology().sample(),
      this.measureSignalingRtt(),
    ]);
    if (this.env.activeSession() !== session) return;

    const totals = { bytesSent: 0, bytesReceived: 0, packetsSent: 0, packetsReceived: 0 };
    for (const { media } of round.readings) {
      if (!media) continue;
      totals.bytesSent += media.bytesSent;
      totals.bytesReceived += media.bytesReceived;
      totals.packetsSent += media.packetsSent;
      totals.packetsReceived += media.packetsReceived;
    }

    round.settle(store.getSnapshot().muted);
    await this.publishDiagnostics(round.readings, totals, signalingRttMs);
  }

  private async publishDiagnostics(
    readings: readonly LinkReading[],
    totals: MediaCounters,
    signalingRttMs: number | null,
  ): Promise<void> {
    const { store, bitrate } = this.env;
    const previous = store.getSnapshot().diagnostics;
    const worst = worstSample(readings.flatMap(({ network }) => (network ? [network] : [])));

    if (!worst) {
      // Before a link reports end-to-end timing, the signalling round trip
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
    if (decision.changed) await this.env.topology().applyMicEncoding();
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
   * Fetch fresh ICE servers and give them to every link.
   *
   * New credentials are for the next gathering phase, so a healthy path keeps
   * running and is not torn up once an hour. A link that is already down can
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

    let appliedToEveryLink = true;
    for (const link of this.env.topology().links()) {
      try {
        const { connection } = link;
        connection.setConfiguration({ ...connection.getConfiguration(), iceServers: servers });
        const state = connection.connectionState;
        if (state === "failed" || state === "disconnected") link.watchdog.arm(state === "failed");
      } catch {
        appliedToEveryLink = false;
      }
    }

    if (!appliedToEveryLink) {
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

// The proof of flow belongs to links, whichever topology made them. These are
// the pieces every topology needs to prove it.

/** Read one link's statistics. Never rejects: a link that cannot report reads as empty. */
export async function readLink(link: Link): Promise<LinkReading> {
  try {
    const report = await link.connection.getStats();
    return {
      link,
      network: summariseStats(report),
      media: summariseMediaCounters(report),
      report,
    };
  } catch {
    return { link, network: null, media: null, report: null };
  }
}

/** Connected for a while, yet no audio has been proven to cross. */
export function isSilent(link: Link): boolean {
  return (
    link.connection.connectionState === "connected" &&
    !link.flow.verified &&
    link.flow.silentSamples >= SILENT_SAMPLE_LIMIT
  );
}

/** After an outage the old counters prove nothing; they have to move again. */
export function expectFreshMedia(flow: MediaFlow): void {
  flow.verified = false;
  flow.silentSamples = 0;
  flow.requireFresh = true;
}

/** Who is excused from carrying audio in one direction. */
export interface FlowExpectation {
  /** This side is muted, so it is not expected to send. */
  selfMuted: boolean;
  /** The other side is muted, so it is not expected to be heard. */
  remoteMuted: boolean;
}

/**
 * Both directions must have carried audio, except that a muted side is not
 * expected to send. After an outage the counters must advance, not merely
 * be positive.
 */
export function proveMediaFlow(
  flow: MediaFlow,
  media: MediaCounters | null,
  { selfMuted, remoteMuted }: FlowExpectation,
): void {
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
  const inbound = remoteMuted || received;
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
