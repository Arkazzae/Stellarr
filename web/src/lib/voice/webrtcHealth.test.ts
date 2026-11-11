import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { polish } from "@/test/translators";
import { AdaptiveBitrateController } from "./bitrate";
import { TURN_SAFETY_MARGIN_MS, type VoiceIceProvider } from "./iceSession";
import { VoiceStateStore } from "./store";
import {
  CallHealth,
  expectFreshMedia,
  isSilent,
  proveMediaFlow,
  readLink,
  type CallHealthEnv,
} from "./webrtcHealth";
import { createLink, type Link, type MediaFlow } from "./webrtcPeer";
import type { TransportReport } from "./webrtcTopology";

const GRACE = 50;

class FakeConnection {
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  remoteDescription = null;
  stats: unknown[] = [];

  constructor(public config: RTCConfiguration) {}

  getStats = vi.fn(async () => this.stats);
  getConfiguration = vi.fn(() => this.config);
  setConfiguration = vi.fn((next: RTCConfiguration) => {
    this.config = next;
  });
}

const audio = (sent: number, received: number) => [
  { type: "outbound-rtp", kind: "audio", packetsSent: sent, bytesSent: sent * 80 },
  { type: "inbound-rtp", kind: "audio", packetsReceived: received, bytesReceived: received * 80 },
];

let store: VoiceStateStore;
let session: number | null;
let ice: VoiceIceProvider & { beginSession: Mock<() => Promise<RTCIceServer[]>> };
let applyMicEncoding: Mock<() => Promise<void>>;
let getRtcClock: Mock<() => Promise<number>>;
let bitrate: AdaptiveBitrateController;
/** The one connection to the media server, which is all a call has. */
let shared: Link;
/** What the topology says about the media; the call publishes it as it is. */
let report: TransportReport;
/** How the topology settles a round of statistics. */
let settle: Mock<(selfMuted: boolean) => void>;
/** The call-wide clocks and diagnostics, reading the connection through its topology. */
let health: CallHealth;

function build(overrides: Partial<CallHealthEnv> = {}): CallHealth {
  return new CallHealth({
    translate: polish,
    realtime: { getRtcClock },
    ice,
    store,
    bitrate,
    activeSession: () => session,
    topology: () => ({
      links: () => [shared],
      transport: () => report,
      sample: async () => ({ readings: [await readLink(shared)], settle }),
      applyMicEncoding,
    }),
    ...overrides,
  });
}

function connection(): FakeConnection {
  return shared.connection as unknown as FakeConnection;
}

beforeEach(() => {
  vi.stubGlobal("RTCPeerConnection", FakeConnection);
  store = new VoiceStateStore();
  session = 1;
  ice = {
    beginSession: vi.fn(async () => [{ urls: "stun:fresh.example" }]),
    current: vi.fn(() => []),
    endSession: vi.fn(),
  };
  applyMicEncoding = vi.fn(async () => undefined);
  getRtcClock = vi.fn(async () => Date.now());
  bitrate = new AdaptiveBitrateController({ ceiling: 128_000, floor: 64_000 });
  shared = createLink({
    iceServers: [],
    recovery: { graceMs: GRACE, maxAttempts: 1, onEscalate: vi.fn(), onExhausted: vi.fn() },
  });
  report = { media: "connecting", peerCount: 0, connectedPeerCount: 0 };
  settle = vi.fn();
  health = build();
});

afterEach(() => {
  health.stop();
  shared.watchdog.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CallHealth transport state", () => {
  it("is idle outside a session", () => {
    session = null;
    health.syncTransport();

    expect(store.getSnapshot().transport).toMatchObject({
      media: "idle",
      peerCount: 0,
      connectedPeerCount: 0,
    });
  });

  it("publishes the topology's media state and keeps the signalling state", () => {
    store.set({
      transport: { signaling: "connected", media: "ready", peerCount: 0, connectedPeerCount: 0 },
    });
    report = { media: "degraded", peerCount: 3, connectedPeerCount: 2 };

    health.syncTransport();

    expect(store.getSnapshot().transport).toEqual({
      signaling: "connected",
      media: "degraded",
      peerCount: 3,
      connectedPeerCount: 2,
    });
  });

  it("keeps the signalling state when it goes idle", () => {
    store.set({ transport: { signaling: "connected", media: "ready", peerCount: 0, connectedPeerCount: 0 } });
    session = null;

    health.syncTransport();

    expect(store.getSnapshot().transport.signaling).toBe("connected");
  });
});

describe("CallHealth diagnostics", () => {
  it("settles a round with this side's mute and reports the connection's counters", async () => {
    store.set({ muted: true });
    connection().stats = audio(5, 7);

    await health.sample();

    expect(settle).toHaveBeenCalledWith(true);
    expect(store.getSnapshot().diagnostics).toMatchObject({
      packetsSent: 5,
      packetsReceived: 7,
      bytesSent: 400,
      bytesReceived: 560,
    });
  });

  it("falls back to the signalling round trip while the connection reports no timing", async () => {
    const clock = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(142);

    await health.sample();

    expect(getRtcClock).toHaveBeenCalled();
    expect(store.getSnapshot().diagnostics).toMatchObject({
      quality: "good",
      lossFraction: null,
      rttMs: 42,
    });
    clock.mockRestore();
  });

  it("prefers the connection's own loss and latency over the signalling round trip", async () => {
    connection().stats = [
      ...audio(1, 1),
      { type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.2, roundTripTime: 0.4 },
    ];

    await health.sample();

    expect(store.getSnapshot().diagnostics).toMatchObject({
      quality: "poor",
      lossFraction: 0.2,
      rttMs: 400,
      bitrate: 128_000,
    });
  });

  it("pushes the new ceiling to the senders when the controller lowers it", async () => {
    connection().stats = [
      ...audio(1, 1),
      { type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.5, roundTripTime: 1 },
    ];

    for (let i = 0; i < 4; i += 1) await health.sample();

    expect(applyMicEncoding).toHaveBeenCalled();
    expect(store.getSnapshot().diagnostics.bitrate).toBeLessThan(128_000);
  });

  it("carries on when the signalling clock or the connection's stats fail", async () => {
    getRtcClock.mockRejectedValue(new Error("hub gone"));
    connection().getStats.mockRejectedValue(new Error("closed"));

    await expect(health.sample()).resolves.toBeUndefined();

    expect(store.getSnapshot().diagnostics.quality).toBe("unknown");
  });

  it("drops a sample taken for a call that has since ended", async () => {
    connection().getStats.mockImplementation(async () => {
      session = 2;
      return audio(1, 1);
    });

    await health.sample();

    expect(settle).not.toHaveBeenCalled();
    expect(store.getSnapshot().diagnostics.packetsSent).toBe(0);
  });

  it("takes no samples outside a session", async () => {
    session = null;

    await health.sample();

    expect(connection().getStats).not.toHaveBeenCalled();
  });

  it("samples on its interval until stopped", async () => {
    vi.useFakeTimers();
    const ticking = build({ statsIntervalMs: 1000 });

    ticking.startStats();
    await vi.advanceTimersByTimeAsync(2500);
    expect(connection().getStats).toHaveBeenCalledTimes(2);

    ticking.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(connection().getStats).toHaveBeenCalledTimes(2);
  });
});

describe("CallHealth ICE credential refresh", () => {
  const NOW = Date.UTC(2030, 0, 1);
  const turn = (expiresInMs: number): RTCIceServer => ({
    urls: "turn:turn.example",
    username: `${Math.floor((NOW + expiresInMs) / 1000)}:user`,
    credential: "secret",
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("refreshes shortly before the first credential expires", async () => {
    health.scheduleIceRefresh(1, [{ urls: "stun:x" }, turn(60 * 60_000)]);

    await vi.advanceTimersByTimeAsync(60 * 60_000 - TURN_SAFETY_MARGIN_MS - 1);
    expect(ice.beginSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(ice.beginSession).toHaveBeenCalledTimes(1);
  });

  it("never schedules anything for credentials that do not expire", async () => {
    health.scheduleIceRefresh(1, [{ urls: "stun:x" }]);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);

    expect(ice.beginSession).not.toHaveBeenCalled();
  });

  it("does not schedule for a call that already ended", async () => {
    session = 2;
    health.scheduleIceRefresh(1, [turn(10 * 60_000)]);

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(ice.beginSession).not.toHaveBeenCalled();
  });

  it("stops the pending refresh on request", async () => {
    health.scheduleIceRefresh(1, [turn(10 * 60_000)]);
    health.stop();

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(ice.beginSession).not.toHaveBeenCalled();
  });

  it("waits in steps when the expiry lies beyond what a timer can hold", async () => {
    health.scheduleIceRefresh(1, [turn(40 * 24 * 60 * 60_000)]);

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60_000);
    expect(ice.beginSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10 * 24 * 60 * 60_000);
    expect(ice.beginSession).toHaveBeenCalledTimes(1);
  });

  it("gives a working connection the new servers for its next gathering, and leaves it be", async () => {
    connection().connectionState = "connected";
    const arm = vi.spyOn(shared.watchdog, "arm");
    const fresh = [turn(2 * 60 * 60_000)];
    ice.beginSession.mockResolvedValue(fresh);

    await health.refreshIce(1);

    expect(connection().setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ iceServers: fresh }),
    );
    expect(arm).not.toHaveBeenCalled();
  });

  it("wakes a connection that is down at once, and one that drifts after its grace", async () => {
    const arm = vi.spyOn(shared.watchdog, "arm");

    connection().connectionState = "failed";
    await health.refreshIce(1);
    connection().connectionState = "disconnected";
    await health.refreshIce(1);

    expect(arm.mock.calls).toEqual([[true], [false]]);
  });

  it("schedules the next refresh from the new credentials", async () => {
    ice.beginSession.mockResolvedValue([turn(2 * 60 * 60_000)]);

    await health.refreshIce(1);
    expect(ice.beginSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000 - TURN_SAFETY_MARGIN_MS);
    expect(ice.beginSession).toHaveBeenCalledTimes(2);
  });

  it("reports a failed refresh as recoverable and tries again later", async () => {
    ice.beginSession.mockRejectedValueOnce(new Error("offline"));

    await health.refreshIce(1);
    expect(store.getSnapshot().error).toMatchObject({ kind: "ice-config", recoverable: true });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(ice.beginSession).toHaveBeenCalledTimes(2);
  });

  it("clears its own error once a refresh succeeds, and nobody else's", async () => {
    store.set({ error: { kind: "ice-config", message: "stale" } });
    await health.refreshIce(1);
    expect(store.getSnapshot().error).toBeNull();

    store.set({ error: { kind: "transport", message: "other" } });
    await health.refreshIce(1);
    expect(store.getSnapshot().error?.kind).toBe("transport");
  });

  it("says so when the connection refuses the refreshed configuration", async () => {
    connection().setConfiguration.mockImplementation(() => {
      throw new Error("InvalidModificationError");
    });

    await health.refreshIce(1);

    expect(store.getSnapshot().error).toMatchObject({ kind: "ice-config", recoverable: true });
  });

  it("ignores a refresh that belongs to an earlier call", async () => {
    await health.refreshIce(7);

    expect(ice.beginSession).not.toHaveBeenCalled();
  });

  it("drops a refresh that finishes after the call ended", async () => {
    ice.beginSession.mockImplementation(async () => {
      session = null;
      return [{ urls: "stun:late.example" }];
    });

    await health.refreshIce(1);

    expect(connection().setConfiguration).not.toHaveBeenCalled();
  });
});

describe("proof of media flow", () => {
  function freshFlow(): MediaFlow {
    return { verified: false, silentSamples: 0, requireFresh: false, lastSent: 0, lastReceived: 0 };
  }

  const counters = (sent: number, received: number) => ({
    packetsSent: sent,
    bytesSent: sent * 80,
    packetsReceived: received,
    bytesReceived: received * 80,
  });
  const nobodyMuted = { selfMuted: false, remoteMuted: false };

  it("proves a connection only once audio has crossed in both directions", () => {
    const flow = freshFlow();

    proveMediaFlow(flow, counters(1, 0), nobodyMuted);
    expect(flow).toMatchObject({ verified: false, silentSamples: 1 });

    proveMediaFlow(flow, counters(2, 1), nobodyMuted);
    expect(flow).toMatchObject({ verified: true, silentSamples: 0 });
  });

  it("does not expect a muted side to send, or a muted person to be heard", () => {
    const mutedHere = freshFlow();
    proveMediaFlow(mutedHere, counters(0, 3), { selfMuted: true, remoteMuted: false });
    expect(mutedHere.verified).toBe(true);

    const mutedThere = freshFlow();
    proveMediaFlow(mutedThere, counters(3, 0), { selfMuted: false, remoteMuted: true });
    expect(mutedThere.verified).toBe(true);
  });

  it("requires the counters to move again after an outage", () => {
    const flow = freshFlow();
    proveMediaFlow(flow, counters(2, 2), nobodyMuted);
    expect(flow.verified).toBe(true);

    expectFreshMedia(flow);
    proveMediaFlow(flow, counters(2, 2), nobodyMuted);
    expect(flow.verified).toBe(false);

    proveMediaFlow(flow, counters(3, 3), nobodyMuted);
    expect(flow.verified).toBe(true);
  });

  it("calls a connected connection silent after three rounds without proof", () => {
    connection().connectionState = "connected";

    for (let i = 0; i < 2; i += 1) proveMediaFlow(shared.flow, null, nobodyMuted);
    expect(isSilent(shared)).toBe(false);

    proveMediaFlow(shared.flow, null, nobodyMuted);
    expect(isSilent(shared)).toBe(true);

    connection().connectionState = "disconnected";
    expect(isSilent(shared)).toBe(false);
  });
});

describe("readLink", () => {
  it("keeps the whole report for a topology that needs more than the summary", async () => {
    connection().stats = audio(2, 3);

    const reading = await readLink(shared);

    expect(reading.report).toBe(connection().stats);
    expect(reading.media).toMatchObject({ packetsSent: 2, packetsReceived: 3 });

    connection().getStats.mockRejectedValue(new Error("closed"));
    expect(await readLink(shared)).toEqual({ link: shared, network: null, media: null, report: null });
  });
});
