import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { UserId } from "@/lib/api/types";
import { polish } from "@/test/translators";
import { AdaptiveBitrateController } from "./bitrate";
import { TURN_SAFETY_MARGIN_MS, type VoiceIceProvider } from "./iceSession";
import { DEFAULT_PARTICIPANT_PREFERENCE } from "./participantPreferences";
import { VoiceStateStore } from "./store";
import { CallHealth, readLink, type CallHealthEnv } from "./webrtcHealth";
import { createPeer, type MeshPeer } from "./webrtcMesh";
import { MeshHealth } from "./webrtcMeshHealth";
import { createLink, type Link } from "./webrtcPeer";

const GRACE = 50;

class FakeConnection {
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  remoteDescription = null;
  stats: unknown[] = [];

  constructor(public config: RTCConfiguration) {}

  addIceCandidate = vi.fn();
  getStats = vi.fn(async () => this.stats);
  restartIce = vi.fn();
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
let peers: Map<UserId, MeshPeer>;
let session: number | null;
let ice: VoiceIceProvider & { beginSession: Mock<() => Promise<RTCIceServer[]>> };
let reoffer: Mock<(link: Link) => Promise<void>>;
let applyMicEncoding: Mock<() => Promise<void>>;
let getRtcClock: Mock<() => Promise<number>>;
let bitrate: AdaptiveBitrateController;
/** The mesh's own judgement of each connection: proof, recovery, the media state. */
let mesh: MeshHealth;
/** The call-wide clocks and diagnostics, reading the mesh as its topology. */
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
      links: () => [...peers.values()].map((peer) => peer.link),
      transport: () => mesh.transport(),
      sample: () => mesh.sample(),
      applyMicEncoding,
    }),
    ...overrides,
  });
}

function addPeer(userId = "u-z", selfUserId = "u-a", muted = false): MeshPeer {
  const peer = createPeer({
    user: { userId, displayName: `Osoba ${userId}`, muted },
    selfUserId,
    iceServers: [],
    preference: { ...DEFAULT_PARTICIPANT_PREFERENCE },
    createVoice: () => ({
      audio: document.createElement("audio"),
      decoder: document.createElement("audio"),
      processed: false,
      streamId: null,
    }),
    recovery: mesh.recovery,
  });
  peers.set(userId, peer);
  return peer;
}

function link(peer: MeshPeer): FakeConnection {
  return peer.link.connection as unknown as FakeConnection;
}

function setState(peer: MeshPeer, state: RTCPeerConnectionState): void {
  link(peer).connectionState = state;
  mesh.onConnectionState(peer.link);
}

beforeEach(() => {
  vi.stubGlobal("RTCPeerConnection", FakeConnection);
  store = new VoiceStateStore();
  peers = new Map();
  session = 1;
  ice = {
    beginSession: vi.fn(async () => [{ urls: "stun:fresh.example" }]),
    current: vi.fn(() => []),
    endSession: vi.fn(),
  };
  reoffer = vi.fn(async () => undefined);
  applyMicEncoding = vi.fn(async () => undefined);
  getRtcClock = vi.fn(async () => Date.now());
  bitrate = new AdaptiveBitrateController({ ceiling: 128_000, floor: 64_000 });
  mesh = new MeshHealth({
    translate: polish,
    store,
    peers,
    recoveryGraceMs: GRACE,
    activeSession: () => session,
    reoffer,
    transportChanged: () => health.syncTransport(),
  });
  health = build();
});

afterEach(() => {
  health.stop();
  for (const peer of peers.values()) peer.link.watchdog.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CallHealth transport state", () => {
  it("is idle outside a session and ready in an empty one", () => {
    session = null;
    health.syncTransport();
    expect(store.getSnapshot().transport.media).toBe("idle");

    session = 1;
    health.syncTransport();
    expect(store.getSnapshot().transport).toMatchObject({
      media: "ready",
      peerCount: 0,
      connectedPeerCount: 0,
    });
  });

  it("keeps the signalling state when the media state changes", () => {
    store.set({ transport: { signaling: "connected", media: "ready", peerCount: 0, connectedPeerCount: 0 } });
    session = null;

    health.syncTransport();

    expect(store.getSnapshot().transport.signaling).toBe("connected");
  });

  it("is connecting while a peer is not connected, and counts connected peers", () => {
    const peer = addPeer();
    health.syncTransport();
    expect(store.getSnapshot().transport).toMatchObject({ media: "connecting", peerCount: 1 });

    setState(peer, "connected");
    expect(store.getSnapshot().transport).toMatchObject({
      media: "connecting",
      connectedPeerCount: 1,
    });
  });

  it("only turns connected once audio has crossed in both directions", async () => {
    const peer = addPeer();
    setState(peer, "connected");

    link(peer).stats = audio(1, 0);
    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("connecting");

    link(peer).stats = audio(2, 1);
    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("connected");
  });

  it("does not expect a muted microphone to send", async () => {
    store.set({ muted: true });
    const peer = addPeer();
    setState(peer, "connected");

    link(peer).stats = audio(0, 3);
    await health.sample();

    expect(store.getSnapshot().transport.media).toBe("connected");
  });

  it("does not expect a muted participant to be heard", async () => {
    const peer = addPeer("u-z", "u-a", true);
    setState(peer, "connected");

    link(peer).stats = audio(3, 0);
    await health.sample();

    expect(store.getSnapshot().transport.media).toBe("connected");
  });

  it("requires the counters to move again after an outage", async () => {
    const peer = addPeer();
    setState(peer, "connected");
    link(peer).stats = audio(2, 2);
    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("connected");

    setState(peer, "disconnected");
    setState(peer, "connected");
    expect(store.getSnapshot().transport.media).toBe("connecting");

    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("connecting");

    link(peer).stats = audio(3, 3);
    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("connected");
  });

  it("reports a degraded call while only some peers carry audio", async () => {
    const flowing = addPeer("u-x");
    const silent = addPeer("u-y");
    setState(flowing, "connected");
    setState(silent, "connected");
    link(flowing).stats = audio(1, 1);

    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("degraded");

    // Still degraded, not failed, once the other one has been silent too long.
    await health.sample();
    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("degraded");
  });

  it("calls a connected peer silent after three samples without audio, then recovers", async () => {
    const peer = addPeer();
    setState(peer, "connected");

    for (let i = 0; i < 3; i += 1) await health.sample();
    expect(store.getSnapshot().transport.media).toBe("failed");
    expect(store.getSnapshot().error).toMatchObject({
      kind: "transport",
      recoverable: true,
      message: expect.stringContaining("Osoba u-z"),
    });

    link(peer).stats = audio(1, 1);
    await health.sample();
    expect(store.getSnapshot().transport.media).toBe("connected");
    expect(store.getSnapshot().error).toBeNull();
  });
});

describe("CallHealth diagnostics", () => {
  it("sums the audio counters of every leg", async () => {
    const first = addPeer("u-x");
    const second = addPeer("u-y");
    setState(first, "connected");
    setState(second, "connected");
    link(first).stats = audio(1, 2);
    link(second).stats = audio(3, 4);

    await health.sample();

    expect(store.getSnapshot().diagnostics).toMatchObject({
      packetsSent: 4,
      packetsReceived: 6,
      bytesSent: 320,
      bytesReceived: 480,
    });
  });

  it("falls back to the signalling round trip while no peer reports timing", async () => {
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

  it("prefers the peers' own loss and latency over the signalling round trip", async () => {
    const peer = addPeer();
    setState(peer, "connected");
    link(peer).stats = [
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
    const peer = addPeer();
    setState(peer, "connected");
    link(peer).stats = [
      ...audio(1, 1),
      { type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.5, roundTripTime: 1 },
    ];

    for (let i = 0; i < 4; i += 1) await health.sample();

    expect(applyMicEncoding).toHaveBeenCalled();
    expect(store.getSnapshot().diagnostics.bitrate).toBeLessThan(128_000);
  });

  it("carries on when the signalling clock or a peer's stats fail", async () => {
    getRtcClock.mockRejectedValue(new Error("hub gone"));
    const peer = addPeer();
    setState(peer, "connected");
    link(peer).getStats.mockRejectedValue(new Error("closed"));

    await expect(health.sample()).resolves.toBeUndefined();

    expect(store.getSnapshot().diagnostics.quality).toBe("unknown");
  });

  it("drops a sample taken for a call that has since ended", async () => {
    const peer = addPeer();
    setState(peer, "connected");
    link(peer).getStats.mockImplementation(async () => {
      session = 2;
      return audio(1, 1);
    });

    await health.sample();

    expect(store.getSnapshot().diagnostics.packetsSent).toBe(0);
  });

  it("takes no samples outside a session", async () => {
    session = null;
    const peer = addPeer();

    await health.sample();

    expect(link(peer).getStats).not.toHaveBeenCalled();
  });

  it("samples on its interval until stopped", async () => {
    vi.useFakeTimers();
    const ticking = build({ statsIntervalMs: 1000 });
    const peer = addPeer();
    setState(peer, "connected");

    ticking.startStats();
    await vi.advanceTimersByTimeAsync(2500);
    expect(link(peer).getStats).toHaveBeenCalledTimes(2);

    ticking.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(link(peer).getStats).toHaveBeenCalledTimes(2);
  });
});

describe("CallHealth recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("waits out a transient disconnect before restarting ICE", () => {
    const peer = addPeer();

    setState(peer, "disconnected");
    expect(link(peer).restartIce).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GRACE);
    expect(link(peer).restartIce).toHaveBeenCalledTimes(1);
  });

  it("gives up on the restart when the peer recovers within the grace window", () => {
    const peer = addPeer();
    setState(peer, "disconnected");

    setState(peer, "connected");
    vi.advanceTimersByTime(GRACE * 5);

    expect(link(peer).restartIce).not.toHaveBeenCalled();
  });

  it("restarts at once after a hard failure without reporting an error", () => {
    const peer = addPeer();

    setState(peer, "failed");

    expect(link(peer).restartIce).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().error).toBeNull();
  });

  it("restarts ICE at most three times however often the link flaps", () => {
    const peer = addPeer();

    for (let i = 0; i < 6; i += 1) setState(peer, "disconnected");
    vi.advanceTimersByTime(GRACE * 6);

    expect(link(peer).restartIce).toHaveBeenCalledTimes(3);
  });

  it("reports the peer lost once the last attempt had its grace window", () => {
    const peer = addPeer();
    setState(peer, "disconnected");

    vi.advanceTimersByTime(GRACE * 3);
    expect(store.getSnapshot().error).toBeNull();
    vi.advanceTimersByTime(GRACE);

    expect(store.getSnapshot().error).toMatchObject({
      kind: "transport",
      recoverable: true,
      message: expect.stringContaining("Osoba u-z"),
    });
    expect(store.getSnapshot().transport.media).toBe("failed");
  });

  it("starts a recovered peer with a fresh budget", () => {
    const peer = addPeer();
    setState(peer, "disconnected");
    vi.advanceTimersByTime(GRACE);
    expect(link(peer).restartIce).toHaveBeenCalledTimes(1);

    setState(peer, "connected");
    setState(peer, "disconnected");
    vi.advanceTimersByTime(GRACE * 6);

    expect(link(peer).restartIce).toHaveBeenCalledTimes(1 + 3);
  });

  it("lets the impolite side carry the restart in a fresh offer", async () => {
    const impolite = addPeer("u-z", "u-a");
    expect(impolite.link.polite).toBe(false);

    setState(impolite, "failed");
    await vi.advanceTimersByTimeAsync(0);

    expect(reoffer).toHaveBeenCalledWith(impolite.link);
  });

  it("leaves the restart offer to the other side when this side is polite", async () => {
    const peer = addPeer("u-a", "u-z");
    expect(peer.link.polite).toBe(true);

    setState(peer, "failed");
    await vi.advanceTimersByTimeAsync(0);

    expect(link(peer).restartIce).toHaveBeenCalled();
    expect(reoffer).not.toHaveBeenCalled();
  });

  it("does not offer while a negotiation is already in flight", async () => {
    const peer = addPeer();
    link(peer).signalingState = "have-local-offer";

    setState(peer, "failed");
    await vi.advanceTimersByTimeAsync(0);

    expect(reoffer).not.toHaveBeenCalled();
  });

  it("does not restart a closed connection or one outside a session", async () => {
    const closed = addPeer("u-x");
    link(closed).connectionState = "closed";
    session = null;

    await mesh.repairUnhealthy();
    mesh.onConnectionState(closed.link);
    vi.advanceTimersByTime(GRACE * 5);

    expect(link(closed).restartIce).not.toHaveBeenCalled();
  });

  it("repairs only the peers that are down", async () => {
    const healthy = addPeer("u-x");
    const broken = addPeer("u-y");
    const drifting = addPeer("u-w");
    link(healthy).connectionState = "connected";
    link(broken).connectionState = "failed";
    link(drifting).connectionState = "disconnected";

    await mesh.repairUnhealthy();

    expect(link(healthy).restartIce).not.toHaveBeenCalled();
    expect(link(broken).restartIce).toHaveBeenCalledTimes(1);
    expect(link(drifting).restartIce).toHaveBeenCalledTimes(1);
  });

  it("survives a browser without restartIce", async () => {
    const peer = addPeer();
    (link(peer) as { restartIce?: unknown }).restartIce = undefined;
    link(peer).connectionState = "failed";

    await mesh.repairUnhealthy();

    expect(reoffer).toHaveBeenCalledWith(peer.link);
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

  it("gives every connection the new servers but restarts only the broken ones", async () => {
    const working = addPeer("u-x");
    const broken = addPeer("u-y");
    link(working).connectionState = "connected";
    link(broken).connectionState = "failed";
    const fresh = [turn(2 * 60 * 60_000)];
    ice.beginSession.mockResolvedValue(fresh);

    await health.refreshIce(1);

    expect(link(working).setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ iceServers: fresh }),
    );
    expect(link(broken).setConfiguration).toHaveBeenCalled();
    expect(link(working).restartIce).not.toHaveBeenCalled();
    expect(link(broken).restartIce).toHaveBeenCalledTimes(1);
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

  it("says so when a connection refuses the refreshed configuration", async () => {
    const stubborn = addPeer("u-x");
    link(stubborn).setConfiguration.mockImplementation(() => {
      throw new Error("InvalidModificationError");
    });
    const other = addPeer("u-y");

    await health.refreshIce(1);

    expect(store.getSnapshot().error).toMatchObject({ kind: "ice-config", recoverable: true });
    expect(link(other).setConfiguration).toHaveBeenCalled();
  });

  it("ignores a refresh that belongs to an earlier call", async () => {
    await health.refreshIce(7);

    expect(ice.beginSession).not.toHaveBeenCalled();
  });

  it("drops a refresh that finishes after the call ended", async () => {
    const peer = addPeer();
    ice.beginSession.mockImplementation(async () => {
      session = null;
      return [{ urls: "stun:late.example" }];
    });

    await health.refreshIce(1);

    expect(link(peer).setConfiguration).not.toHaveBeenCalled();
  });
});

describe("CallHealth with one link shared by several people", () => {
  // The shape a media server gives a call: whatever the topology says about
  // the people behind the link is published as it is.
  function sharedLink() {
    const shared = createLink({
      iceServers: [],
      polite: false,
      recovery: { graceMs: GRACE, maxAttempts: 3, onEscalate: vi.fn(), onExhausted: vi.fn() },
    });
    const settle = vi.fn<(selfMuted: boolean) => void>();
    const topology = {
      links: () => [shared],
      transport: () => ({ media: "degraded" as const, peerCount: 3, connectedPeerCount: 2 }),
      sample: async () => ({ readings: [await readLink(shared)], settle }),
      applyMicEncoding,
    };
    const fake = shared.connection as unknown as FakeConnection;
    return { shared, fake, settle, call: build({ topology: () => topology }) };
  }

  it("publishes the topology's media state and keeps the signalling state", () => {
    store.set({
      transport: { signaling: "connected", media: "ready", peerCount: 0, connectedPeerCount: 0 },
    });
    const { call } = sharedLink();

    call.syncTransport();

    expect(store.getSnapshot().transport).toEqual({
      signaling: "connected",
      media: "degraded",
      peerCount: 3,
      connectedPeerCount: 2,
    });
  });

  it("settles a round with this side's mute and reports its counters", async () => {
    store.set({ muted: true });
    const { fake, settle, call } = sharedLink();
    fake.stats = audio(5, 7);

    await call.sample();

    expect(settle).toHaveBeenCalledWith(true);
    expect(store.getSnapshot().diagnostics).toMatchObject({ packetsSent: 5, packetsReceived: 7 });
  });

  it("does not settle a round that finished after the call ended", async () => {
    const { fake, settle, call } = sharedLink();
    fake.getStats.mockImplementation(async () => {
      session = 2;
      return audio(1, 1);
    });

    await call.sample();

    expect(settle).not.toHaveBeenCalled();
  });

  it("gives the fresh servers to the topology's link and wakes it when it is down", async () => {
    const { shared, fake, call } = sharedLink();
    fake.connectionState = "failed";
    const arm = vi.spyOn(shared.watchdog, "arm");

    await call.refreshIce(1);

    expect(fake.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ iceServers: [{ urls: "stun:fresh.example" }] }),
    );
    expect(arm).toHaveBeenCalledWith(true);
    shared.watchdog.dispose();
  });
});

describe("readLink", () => {
  it("keeps the whole report for a topology that needs more than the summary", async () => {
    const link = createLink({
      iceServers: [],
      polite: false,
      recovery: { graceMs: GRACE, maxAttempts: 3, onEscalate: vi.fn(), onExhausted: vi.fn() },
    });
    const fake = link.connection as unknown as FakeConnection;
    fake.stats = audio(2, 3);

    const reading = await readLink(link);

    expect(reading.report).toBe(fake.stats);
    expect(reading.media).toMatchObject({ packetsSent: 2, packetsReceived: 3 });

    fake.getStats.mockRejectedValue(new Error("closed"));
    expect(await readLink(link)).toEqual({ link, network: null, media: null, report: null });
  });
});
