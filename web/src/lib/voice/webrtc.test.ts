import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeClient,
  RealtimeEventMap,
  RealtimeEventName,
  VoiceSignal,
} from "@/lib/realtime/types";
import { RTC_PROTOCOL_VERSION, type RtcProtocolVersion } from "@/lib/rtc/protocol";
import { IceConfigError, type VoiceIceProvider } from "./iceSession";
import { ParticipantPreferencesStore } from "./participantPreferences";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { WebRtcVoiceClient } from "./webrtc";

const CHANNEL = "ch-salon";
const TARGET_CHANNEL = "ch-nocna-zmiana";
const OFFER_SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:0 PCMU/8000",
  "",
].join("\r\n");

// ---- fakes -----------------------------------------------------------------

class FakeSender {
  parameters: RTCRtpSendParameters = {
    encodings: [{}],
    transactionId: "t",
    codecs: [],
    headerExtensions: [],
    rtcp: {},
  } as unknown as RTCRtpSendParameters;

  constructor(public track: MediaStreamTrack | null) {}
  replaceTrack = vi.fn(async (next: MediaStreamTrack | null) => {
    this.track = next;
  });
  getParameters = vi.fn(() => this.parameters);
  setParameters = vi.fn(async (next: RTCRtpSendParameters) => {
    this.parameters = next;
  });
  setStreams = vi.fn();
}

class FakeTransceiver {
  setCodecPreferences = vi.fn();
  mid: string | null = null;
  constructor(public sender: FakeSender) {}
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  transceivers: FakeTransceiver[] = [];
  addedCandidates: Array<RTCIceCandidateInit | undefined> = [];
  rollbacks = 0;

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: unknown = null;
  onnegotiationneeded: unknown = null;
  onconnectionstatechange: unknown = null;

  constructor(public config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  getConfiguration = vi.fn(() => this.config);
  setConfiguration = vi.fn((next: RTCConfiguration) => {
    this.config = next;
  });

  addTrack(track: MediaStreamTrack): FakeSender {
    const sender = new FakeSender(track);
    const transceiver = new FakeTransceiver(sender);
    transceiver.mid = String(this.transceivers.length);
    this.transceivers.push(transceiver);
    return sender;
  }

  getTransceivers(): FakeTransceiver[] {
    return this.transceivers;
  }

  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: OFFER_SDP }));
  createAnswer = vi.fn(async () => ({ type: "answer" as const, sdp: OFFER_SDP }));

  setLocalDescription = vi.fn(async (description?: RTCSessionDescriptionInit) => {
    if (description?.type === "rollback") {
      this.rollbacks += 1;
      this.signalingState = "stable";
      return;
    }
    this.localDescription = description ?? { type: "offer", sdp: OFFER_SDP };
    this.signalingState =
      this.localDescription.type === "offer" ? "have-local-offer" : "stable";
  });

  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  });

  addIceCandidate = vi.fn(async (candidate?: RTCIceCandidateInit) => {
    this.addedCandidates.push(candidate);
  });

  removedSenders: FakeSender[] = [];
  removeTrack = vi.fn((sender: FakeSender) => {
    this.removedSenders.push(sender);
    this.transceivers = this.transceivers.filter((item) => item.sender !== sender);
  });

  restartIce = vi.fn();

  getStats = vi.fn(async () => this.stats);
  stats: unknown[] = [];

  close = vi.fn(() => {
    this.connectionState = "closed";
  });
}

class FakeRealtime implements RealtimeClient {
  sent: VoiceSignal[] = [];
  private handlers = new Map<RealtimeEventName, Array<(payload: never) => void>>();

  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  getStatus = vi.fn(() => "connected" as const);
  subscribeStatus = vi.fn((listener: () => void) => {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((item) => item !== listener);
    };
  });
  setPresence = vi.fn(async () => {});
  joinChannel = vi.fn(async () => {});
  sendTyping = vi.fn(async () => {});
  joinVoice = vi.fn(async () => {});
  leaveVoice = vi.fn(async () => {});
  declineDirectCall = vi.fn(async () => {});
  sendVoiceSignal = vi.fn(async (signal: VoiceSignal) => {
    this.sent.push(signal);
  });
  playSoundboard = vi.fn(async () => {});
  getRtcClock = vi.fn(async () => Date.now());

  on<E extends RealtimeEventName>(
    event: E,
    handler: (payload: RealtimeEventMap[E]) => void,
  ): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (payload: never) => void);
    this.handlers.set(event, list);
    return () => {};
  }

  private statusListeners: Array<() => void> = [];

  emitStatus(): void {
    for (const listener of this.statusListeners) listener();
  }

  emit<E extends RealtimeEventName>(
    event: E,
    payload: E extends "VoiceSignal"
      ? Omit<VoiceSignal, "protocolVersion"> & { protocolVersion?: RtcProtocolVersion }
      : RealtimeEventMap[E],
  ): void {
    const normalized =
      event === "VoiceSignal"
        ? { protocolVersion: RTC_PROTOCOL_VERSION, ...payload }
        : payload;
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (value: RealtimeEventMap[E]) => void)(
        normalized as RealtimeEventMap[E],
      );
    }
  }
}

function fakeTrack(kind: "audio" | "video" = "audio"): MediaStreamTrack {
  return {
    kind,
    enabled: true,
    contentHint: "",
    stop: vi.fn(),
    onended: null,
    getSettings: () => ({ channelCount: 1 }),
    applyConstraints: vi.fn(async () => {}),
  } as unknown as MediaStreamTrack;
}

function mediaDevice(
  kind: MediaDeviceKind,
  deviceId: string,
): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    groupId: "group",
    label: deviceId,
    toJSON: () => ({}),
  };
}

function fakeStream(...tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `stream-${streamCounter++}`,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

let streamCounter = 0;

function fakeStreamWithId(id: string, ...tracks: MediaStreamTrack[]): MediaStream {
  return {
    id,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const ICE: RTCIceServer[] = [
  { urls: ["stun:orbit.example:3478"] },
  {
    urls: ["turn:orbit.example:3478?transport=udp"],
    username: "4102444800:abc",
    credential: "secret==",
  },
];

/** Records how often a session is refreshed versus read per peer. */
class FakeIceProvider implements VoiceIceProvider {
  beginSession = vi.fn(async () => {
    this.session = this.next;
    return this.session;
  });
  current = vi.fn(() => this.session);
  endSession = vi.fn(() => {
    this.session = [];
  });

  next: RTCIceServer[] = ICE;
  private session: RTCIceServer[] = [];
}

let realtime: FakeRealtime;
let track: MediaStreamTrack;
let ice: FakeIceProvider;
let displayTracks: MediaStreamTrack[];
let enumeratedDevices: MediaDeviceInfo[];
let deviceChangeListener: EventListener | null;

let settings: VoiceSettings;

function build(
  selfUserId = "u-a",
  updateSettings?: (patch: Partial<VoiceSettings>) => void,
) {
  return new WebRtcVoiceClient({
    realtime,
    selfUserId,
    selfDisplayName: "Ja",
    ice,
    rtc: { protocolVersion: RTC_PROTOCOL_VERSION, topology: "mesh" },
    getSettings: () => settings,
    updateSettings,
    statsIntervalMs: 10_000,
    recoveryGraceMs: 50,
  });
}

/** Join, then announce the given peer so a peer connection is built. */
async function joinWith(client: WebRtcVoiceClient, peerId: string) {
  await client.join(CHANNEL);
  realtime.emit("VoiceParticipantChanged", {
    channelId: CHANNEL,
    participants: [{ userId: peerId, displayName: "Ktoś", muted: false }],
  });
  // Let the async peer construction settle.
  await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
  await Promise.resolve();
  return FakePeerConnection.instances[0]!;
}

async function sampleStats(client: WebRtcVoiceClient): Promise<void> {
  await (
    client as unknown as { sampleStats(): Promise<void> }
  ).sampleStats();
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  realtime = new FakeRealtime();
  track = fakeTrack();
  displayTracks = [fakeTrack("video")];
  enumeratedDevices = [];
  deviceChangeListener = null;
  settings = { ...DEFAULT_SETTINGS };
  ice = new FakeIceProvider();

  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("RTCRtpReceiver", {
    getCapabilities: () => ({
      codecs: [
        { mimeType: "audio/PCMU", clockRate: 8000 },
        { mimeType: "audio/opus", clockRate: 48000, channels: 2 },
      ],
    }),
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => fakeStream(track)),
      getDisplayMedia: vi.fn(async () => fakeStream(...displayTracks)),
      enumerateDevices: vi.fn(async () => enumeratedDevices),
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "devicechange") deviceChangeListener = listener;
      }),
      removeEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "devicechange" && deviceChangeListener === listener) {
          deviceChangeListener = null;
        }
      }),
    },
  });
  vi.stubGlobal("RTCRtpSender", {
    getCapabilities: () => ({ codecs: [{ mimeType: "video/VP8" }, { mimeType: "video/VP9" }] }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebRtcVoiceClient — ICE configuration", () => {
  it("measures signaling latency while the voice channel has no peers", async () => {
    const client = build();
    await client.join(CHANNEL);
    const clock = vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(142);

    await sampleStats(client);

    expect(realtime.getRtcClock).toHaveBeenCalled();
    expect(client.getSnapshot().diagnostics).toMatchObject({
      quality: "good",
      lossFraction: null,
      rttMs: 42,
    });
    clock.mockRestore();
    client.dispose();
  });

  it("keeps signaling health separate from media health", async () => {
    const client = build();
    await client.join(CHANNEL);

    expect(client.getSnapshot().transport).toEqual({
      signaling: "connected",
      media: "ready",
      peerCount: 0,
      connectedPeerCount: 0,
    });

    const pc = await joinWith(client, "u-z");
    expect(client.getSnapshot().transport.media).toBe("connecting");
    expect(client.getSnapshot().transport.connectedPeerCount).toBe(0);

    pc.connectionState = "connected";
    (pc.onconnectionstatechange as unknown as () => void)();
    // ICE/DTLS saying "connected" is not enough: prove that audio RTP moves in
    // both directions before the dock turns green.
    pc.stats = [
      { type: "outbound-rtp", kind: "audio", packetsSent: 1, bytesSent: 80 },
      { type: "inbound-rtp", kind: "audio", packetsReceived: 1, bytesReceived: 80 },
    ];
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({
      signaling: "connected",
      media: "connected",
      peerCount: 1,
      connectedPeerCount: 1,
    });
    client.dispose();
  });

  it("refuses an incompatible RTC contract before opening the microphone", async () => {
    const client = new WebRtcVoiceClient({
      realtime,
      selfUserId: "u-a",
      selfDisplayName: "Ja",
      ice,
      rtc: { protocolVersion: 2, topology: "mesh" },
    });

    await client.join(CHANNEL);

    expect(client.getSnapshot()).toMatchObject({
      connection: "failed",
      transport: { signaling: "disconnected", media: "failed" },
      error: { kind: "unsupported" },
    });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(realtime.joinVoice).not.toHaveBeenCalled();
    client.dispose();
  });

  it("builds each peer connection from the refreshed session servers", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    expect(ice.beginSession).toHaveBeenCalled();
    expect(pc.config.iceServers).toEqual(ICE);
    expect(pc.config.bundlePolicy).toBe("max-bundle");
    client.dispose();
  });

  it("passes the per-user TURN credential through untouched", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const turn = (pc.config.iceServers ?? []).find((server) =>
      String(server.urls).includes("turn:"),
    );
    expect(turn?.username).toBe("4102444800:abc");
    expect(turn?.credential).toBe("secret==");
    client.dispose();
  });

  it("does not touch the network until someone actually joins", async () => {
    const client = build();
    expect(ice.beginSession).not.toHaveBeenCalled();
    await joinWith(client, "u-z");
    expect(ice.beginSession).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("refreshes the configuration before joining signalling", async () => {
    const order: string[] = [];
    ice.beginSession.mockImplementation(async () => {
      order.push("refresh");
      return ICE;
    });
    realtime.joinVoice.mockImplementation(async () => {
      order.push("joinVoice");
    });

    const client = build();
    await client.join(CHANNEL);

    // A peer connection built from a stale credential would never relay, so the
    // refresh has to win this race every time.
    expect(order).toEqual(["refresh", "joinVoice"]);
    client.dispose();
  });

  it("refreshes once for a channel with three people, not once per peer", async () => {
    const client = build();
    await client.join(CHANNEL);

    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [
        { userId: "u-x", displayName: "X", muted: false },
        { userId: "u-y", displayName: "Y", muted: false },
        { userId: "u-z", displayName: "Z", muted: false },
      ],
    });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(3));

    expect(ice.beginSession).toHaveBeenCalledTimes(1);
    expect(ice.current).toHaveBeenCalledTimes(3);
    for (const pc of FakePeerConnection.instances) {
      expect(pc.config.iceServers).toEqual(ICE);
    }
    client.dispose();
  });

  it("refreshes again after leaving and rejoining", async () => {
    const client = build();
    await client.join(CHANNEL);
    expect(ice.beginSession).toHaveBeenCalledTimes(1);

    await client.leave();
    expect(ice.endSession).toHaveBeenCalled();

    await client.join(CHANNEL);
    expect(ice.beginSession).toHaveBeenCalledTimes(2);
    client.dispose();
  });

  it("rotates ICE servers without restarting a healthy live path", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    pc.connectionState = "connected";
    const refreshed: RTCIceServer[] = [
      { urls: ["stun:new.example:3478"] },
      {
        urls: ["turns:new.example:5349?transport=tcp"],
        username: "4102448400:abc",
        credential: "fresh==",
      },
    ];
    ice.next = refreshed;
    const internal = client as unknown as {
      session: number;
      refreshIceConfiguration(session: number): Promise<void>;
    };

    await internal.refreshIceConfiguration(internal.session);

    expect(ice.beginSession).toHaveBeenCalledTimes(2);
    expect(pc.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ iceServers: refreshed }),
    );
    expect(pc.restartIce).not.toHaveBeenCalled();
    client.dispose();
  });

  it("uses refreshed ICE servers immediately only for unhealthy peers", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [
        { userId: "u-x", displayName: "X", muted: false },
        { userId: "u-z", displayName: "Z", muted: false },
      ],
    });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    const [healthy, broken] = FakePeerConnection.instances;
    healthy!.connectionState = "connected";
    broken!.connectionState = "failed";
    ice.next = [{ urls: ["stun:fresh.example:3478"] }];
    const internal = client as unknown as {
      session: number;
      refreshIceConfiguration(session: number): Promise<void>;
    };

    await internal.refreshIceConfiguration(internal.session);

    expect(healthy!.setConfiguration).toHaveBeenCalled();
    expect(broken!.setConfiguration).toHaveBeenCalled();
    expect(healthy!.restartIce).not.toHaveBeenCalled();
    expect(broken!.restartIce).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("surfaces a refresh failure through the voice state and stays recoverable", async () => {
    ice.beginSession.mockRejectedValueOnce(
      new IceConfigError("expired", "credentials expired"),
    );

    const client = build();
    await client.join(CHANNEL);

    const failed = client.getSnapshot();
    expect(failed.connection).toBe("failed");
    expect(failed.error?.kind).toBe("ice-config");
    expect(failed.error?.message).toContain("wygasła");
    // The dock needs the channel to render the error and its retry.
    expect(failed.channelId).toBe(CHANNEL);
    // Nothing was built on a credential we do not trust.
    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(realtime.joinVoice).not.toHaveBeenCalled();

    // Retrying is the documented recovery, and it works.
    await client.join(CHANNEL);
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("releases the microphone when a join is abandoned", async () => {
    ice.beginSession.mockRejectedValueOnce(
      new IceConfigError("unavailable", "no config"),
    );

    const client = build();
    await client.join(CHANNEL);

    // An open mic after a failed join is a privacy problem, not just untidy.
    expect(track.stop).toHaveBeenCalled();
    client.dispose();
  });

  it("distinguishes an unreachable server from expired credentials", async () => {
    ice.beginSession.mockRejectedValueOnce(
      new IceConfigError("unavailable", "no config"),
    );

    const client = build();
    await client.join(CHANNEL);

    expect(client.getSnapshot().error?.message).toContain("pobrać");
    client.dispose();
  });

  it("does not claim media is connected when RTP counters stay at zero", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    pc.connectionState = "connected";
    (pc.onconnectionstatechange as unknown as () => void)();

    await sampleStats(client);
    await sampleStats(client);
    await sampleStats(client);

    expect(client.getSnapshot().transport.media).toBe("failed");
    expect(client.getSnapshot().error?.kind).toBe("transport");
    client.dispose();
  });

  it("requires fresh RTP proof after an ICE disconnect recovers", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    pc.connectionState = "connected";
    pc.stats = [
      { type: "outbound-rtp", kind: "audio", packetsSent: 1 },
      { type: "inbound-rtp", kind: "audio", packetsReceived: 1 },
    ];
    (pc.onconnectionstatechange as unknown as () => void)();
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connected");

    pc.connectionState = "disconnected";
    (pc.onconnectionstatechange as unknown as () => void)();
    pc.connectionState = "connected";
    (pc.onconnectionstatechange as unknown as () => void)();

    expect(client.getSnapshot().transport.media).toBe("connecting");
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connecting");

    pc.stats = [
      { type: "outbound-rtp", kind: "audio", packetsSent: 2 },
      { type: "inbound-rtp", kind: "audio", packetsReceived: 2 },
    ];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connected");
    client.dispose();
  });
});

describe("WebRtcVoiceClient — audio tuning", () => {
  it("marks the microphone track as speech", async () => {
    const client = build();
    await client.join(CHANNEL);
    expect(track.contentHint).toBe("speech");
    client.dispose();
  });

  it("requests mono 48 kHz capture with the browser's echo and noise processing on", async () => {
    settings = { ...settings, noiseSuppression: "browser" };
    const client = build();
    await client.join(CHANNEL);

    const constraints = (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(constraints.audio).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      // Automatic volume is the pipeline's own leveller; the platform AGC is
      // switched back on only if that graph cannot be built.
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000,
    });
    client.dispose();
  });

  it("sends an offer carrying the Opus parameters", async () => {
    const client = build();
    await joinWith(client, "u-z");

    const offer = realtime.sent.find((signal) => signal.kind === "offer");
    const sdp = JSON.parse(offer?.payload ?? "{}").sdp as string;
    expect(sdp).toContain("usedtx=0");
    expect(sdp).toContain("useinbandfec=1");
    expect(sdp).toContain("maxaveragebitrate=128000");
    expect(sdp).toContain("stereo=0");
    expect(sdp).toContain("sprop-stereo=0");
    expect(sdp).toContain("minptime=10");
    expect(sdp).toContain("a=ptime:20");
    client.dispose();
  });

  it("prefers Opus through setCodecPreferences", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const preferences = pc.transceivers[0]?.setCodecPreferences;
    expect(preferences).toHaveBeenCalled();
    const ordered = preferences?.mock.calls[0]?.[0] as RTCRtpCodec[];
    expect(ordered[0]?.mimeType).toBe("audio/opus");
    expect(ordered).toHaveLength(2);
    client.dispose();
  });

  it("caps the default Premium encoding at 128 kbps", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    await vi.waitFor(() =>
      expect(pc.transceivers[0]?.sender.setParameters).toHaveBeenCalled(),
    );
    const applied = pc.transceivers[0]?.sender.setParameters.mock
      .calls[0]?.[0] as RTCRtpSendParameters;
    expect(applied.encodings[0]?.maxBitrate).toBe(128000);
    client.dispose();
  });

  it("drives the Studio profile through SDP and sender parameters", async () => {
    settings = { ...settings, opusProfile: "studio" };
    const client = build();
    const pc = await joinWith(client, "u-z");

    const offer = realtime.sent.find((signal) => signal.kind === "offer");
    const sdp = JSON.parse(offer?.payload ?? "{}").sdp as string;
    expect(sdp).toContain("maxaveragebitrate=256000");
    await vi.waitFor(() =>
      expect(pc.transceivers[0]?.sender.setParameters).toHaveBeenCalled(),
    );
    const applied = pc.transceivers[0]?.sender.setParameters.mock
      .calls[0]?.[0] as RTCRtpSendParameters;
    expect(applied.encodings[0]?.maxBitrate).toBe(256000);
    client.dispose();
  });

  it("keeps a receiver-side volume for each remote participant", async () => {
    const client = build();
    await joinWith(client, "u-z");
    await vi.waitFor(() =>
      expect(
        client.getSnapshot().peers.find((peer) => !peer.self)?.playbackVolume,
      ).toBe(100),
    );

    client.setPeerVolume("u-z", 165);
    expect(client.getSnapshot().peers.find((peer) => !peer.self)?.playbackVolume).toBe(
      165,
    );
    client.dispose();
  });

  it("keeps a receiver-side gate for each remote participant", async () => {
    const client = build();
    await joinWith(client, "u-z");
    await vi.waitFor(() =>
      expect(client.getSnapshot().peers.find((peer) => !peer.self)?.gated).toBe(false),
    );

    client.setPeerGate("u-z", true);
    expect(client.getSnapshot().peers.find((peer) => !peer.self)?.gated).toBe(true);
    // Your own strip is never gated locally: there is nothing to gate.
    expect(client.getSnapshot().peers.find((peer) => peer.self)?.gated).toBe(false);
    client.setPeerGate("u-z", false);
    expect(client.getSnapshot().peers.find((peer) => !peer.self)?.gated).toBe(false);
    client.dispose();
  });

  it("keeps a receiver-side suppressor for each remote participant", async () => {
    const client = build();
    await joinWith(client, "u-z");
    await vi.waitFor(() =>
      expect(client.getSnapshot().peers.find((peer) => !peer.self)?.suppressed).toBe(false),
    );

    client.setPeerSuppression("u-z", true);
    expect(client.getSnapshot().peers.find((peer) => !peer.self)?.suppressed).toBe(true);
    expect(client.getSnapshot().peers.find((peer) => peer.self)?.suppressed).toBe(false);
    client.setPeerSuppression("u-z", false);
    expect(client.getSnapshot().peers.find((peer) => !peer.self)?.suppressed).toBe(false);
    client.dispose();
  });

  it("starts a returning participant the way they sounded last time, and remembers changes", async () => {
    const preferences = new ParticipantPreferencesStore(null, "u-a");
    preferences.set("u-z", { volume: 40, gated: true, suppressed: true });
    const client = new WebRtcVoiceClient({
      realtime,
      selfUserId: "u-a",
      selfDisplayName: "Ja",
      ice,
      rtc: { protocolVersion: RTC_PROTOCOL_VERSION, topology: "mesh" },
      getSettings: () => settings,
      participantPreferences: preferences,
      statsIntervalMs: 10_000,
      recoveryGraceMs: 50,
    });
    await joinWith(client, "u-z");
    await vi.waitFor(() =>
      expect(client.getSnapshot().peers.find((peer) => !peer.self)).toMatchObject({
        playbackVolume: 40,
        gated: true,
        suppressed: true,
      }),
    );

    client.setPeerVolume("u-z", 70);
    client.setPeerGate("u-z", false);
    expect(preferences.get("u-z")).toEqual({ volume: 70, gated: false, suppressed: true });
    client.dispose();
  });

  it("still connects when the stack rejects the edited SDP", async () => {
    // The polite side answers rather than offering, so this exercises the
    // answer path without a negotiation collision in the way.
    const client = build("u-z");
    const pc = await joinWith(client, "u-a");
    pc.setLocalDescription.mockRejectedValueOnce(new Error("InvalidModification"));
    realtime.sent.length = 0;

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-a",
      kind: "offer",
      payload: JSON.stringify({ type: "offer", sdp: OFFER_SDP }),
    });

    // Falls back to the untouched description instead of failing the call.
    await vi.waitFor(() =>
      expect(realtime.sent.some((signal) => signal.kind === "answer")).toBe(true),
    );
    client.dispose();
  });
});

describe("WebRtcVoiceClient — candidate handling", () => {
  it("does not poison the call when a targeted frame loses a departing peer", async () => {
    realtime.sendVoiceSignal.mockImplementation(async (signal) => {
      if (signal.toUserId !== undefined) throw new Error("peer already left");
    });
    const client = build();

    await joinWith(client, "u-z");
    await Promise.resolve();

    expect(client.getSnapshot().connection).toBe("connected");
    expect(client.getSnapshot().error).toBeNull();
    client.dispose();
  });

  it("queues a candidate that arrives before the remote description", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "candidate",
      payload: JSON.stringify({ candidate: "candidate:a", sdpMid: "0" }),
    });
    await Promise.resolve();

    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    client.dispose();
  });

  it("flushes queued candidates in order once the answer lands", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    for (const foundation of ["a", "b", "c"]) {
      realtime.emit("VoiceSignal", {
        channelId: CHANNEL,
        fromUserId: "u-z",
        kind: "candidate",
        payload: JSON.stringify({ candidate: `candidate:${foundation}`, sdpMid: "0" }),
      });
    }
    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "answer",
      payload: JSON.stringify({ type: "answer", sdp: OFFER_SDP }),
    });

    await vi.waitFor(() => expect(pc.addIceCandidate).toHaveBeenCalledTimes(3));
    expect(pc.addedCandidates.map((c) => c?.candidate)).toEqual([
      "candidate:a",
      "candidate:b",
      "candidate:c",
    ]);
    client.dispose();
  });

  it("forwards end-of-candidates to the peer", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    realtime.sent.length = 0;

    pc.onicecandidate?.({ candidate: null });
    await vi.waitFor(() => expect(realtime.sent).toHaveLength(1));
    expect(realtime.sent[0]?.payload).toBe("null");
    client.dispose();
  });

  it("accepts a null candidate from the peer without throwing", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "answer",
      payload: JSON.stringify({ type: "answer", sdp: OFFER_SDP }),
    });
    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "candidate",
      payload: "null",
    });

    await vi.waitFor(() => expect(pc.addIceCandidate).toHaveBeenCalled());
    expect(pc.addedCandidates[0]).toEqual({
      candidate: "",
      sdpMid: "",
      sdpMLineIndex: 0,
    });
    client.dispose();
  });
});

describe("WebRtcVoiceClient — perfect negotiation", () => {
  it("ignores a colliding offer on the impolite side", async () => {
    // "u-a" < "u-z", so this client is the impolite one.
    const client = build("u-a");
    const pc = await joinWith(client, "u-z");
    expect(pc.signalingState).toBe("have-local-offer");

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "offer",
      payload: JSON.stringify({ type: "offer", sdp: OFFER_SDP }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    client.dispose();
  });

  it("accepts a colliding offer on the polite side", async () => {
    // "u-z" > "u-a", so this client is polite and must yield.
    const client = build("u-z");
    const pc = await joinWith(client, "u-a");
    // The polite side does not open with an offer.
    expect(pc.signalingState).toBe("stable");

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-a",
      kind: "offer",
      payload: JSON.stringify({ type: "offer", sdp: OFFER_SDP }),
    });

    await vi.waitFor(() => expect(pc.setRemoteDescription).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(realtime.sent.some((signal) => signal.kind === "answer")).toBe(true),
    );
    client.dispose();
  });

  it("rolls back explicitly when implicit rollback is unsupported", async () => {
    const client = build("u-z");
    const pc = await joinWith(client, "u-a");

    // Force the polite side into have-local-offer, then collide.
    await pc.setLocalDescription({ type: "offer", sdp: OFFER_SDP });
    pc.setRemoteDescription.mockRejectedValueOnce(new Error("InvalidStateError"));

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-a",
      kind: "offer",
      payload: JSON.stringify({ type: "offer", sdp: OFFER_SDP }),
    });

    await vi.waitFor(() => expect(pc.rollbacks).toBe(1));
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(2);
    client.dispose();
  });

  it("closes the candidate queue when a peer leaves", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [],
    });
    await vi.waitFor(() => expect(pc.close).toHaveBeenCalled());

    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "candidate",
      payload: JSON.stringify({ candidate: "candidate:late", sdpMid: "0" }),
    });
    await Promise.resolve();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    client.dispose();
  });
});


describe("WebRtcVoiceClient — live settings changes", () => {
  it("joins on the system microphone when a persisted device is gone", async () => {
    settings = { ...settings, inputDeviceId: "missing-usb-mic" };
    const updateSettings = vi.fn();
    const replacement = fakeTrack();
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia);
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
      .mockResolvedValueOnce(fakeStream(replacement));
    const client = build("u-a", updateSettings);

    await client.join(CHANNEL);

    expect(updateSettings).toHaveBeenCalledWith({ inputDeviceId: null });
    expect(getUserMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        audio: expect.objectContaining({
          deviceId: { exact: "missing-usb-mic" },
        }),
      }),
    );
    expect(getUserMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ audio: expect.not.objectContaining({ deviceId: expect.anything() }) }),
    );
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("replaces the outgoing track on every peer without leaving the channel", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [
        { userId: "u-x", displayName: "X", muted: false },
        { userId: "u-z", displayName: "Z", muted: false },
      ],
    });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));

    const replacement = fakeTrack();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeStream(replacement),
    );

    await client.applySettings({ ...settings, inputDeviceId: "other-mic" });

    for (const pc of FakePeerConnection.instances) {
      expect(pc.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(replacement);
    }
    // Still in the call: no leave, no rejoin.
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("stops the previous device so the microphone indicator goes out", async () => {
    const client = build();
    await client.join(CHANNEL);

    const replacement = fakeTrack();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeStream(replacement),
    );
    await client.applySettings({ ...settings, inputDeviceId: "other-mic" });

    expect(track.stop).toHaveBeenCalled();
    client.dispose();
  });

  it("rolls back and stays on the call when the new device fails", async () => {
    const client = build();
    await client.join(CHANNEL);
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("gone", "NotFoundError"),
    );

    await client.applySettings({ ...settings, inputDeviceId: "unplugged" });

    const state = client.getSnapshot();
    expect(state.connection).toBe("connected");
    expect(state.error?.recoverable).toBe(true);
    // The original device is still running.
    expect(track.stop).not.toHaveBeenCalled();
    client.dispose();
  });

  it("applies a profile change without reopening the microphone", async () => {
    const client = build();
    await client.join(CHANNEL);
    const calls = (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock
      .calls.length;

    await client.applySettings({ ...settings, opusProfile: "clarity" });

    expect(
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(calls);
    client.dispose();
  });

  it("coalesces rapid device changes and never adopts a stale slow capture", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const getUserMedia = navigator.mediaDevices
      .getUserMedia as ReturnType<typeof vi.fn>;
    const first = deferred<MediaStream>();
    const second = deferred<MediaStream>();
    const staleTrack = fakeTrack();
    const latestTrack = fakeTrack();
    getUserMedia.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const selectingFirst = client.applySettings({
      ...settings,
      inputDeviceId: "mic-slow",
    });
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    const selectingLatest = client.applySettings({
      ...settings,
      inputDeviceId: "mic-latest",
    });

    first.resolve(fakeStream(staleTrack));
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3));
    second.resolve(fakeStream(latestTrack));
    await Promise.all([selectingFirst, selectingLatest]);

    const sender = pc.transceivers[0]!.sender;
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1);
    expect(sender.replaceTrack).toHaveBeenCalledWith(latestTrack);
    expect(staleTrack.stop).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("rolls every peer back when one sender rejects a microphone swap", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [
        { userId: "u-x", displayName: "X", muted: false },
        { userId: "u-z", displayName: "Z", muted: false },
      ],
    });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    const [accepted, rejected] = FakePeerConnection.instances.map(
      (pc) => pc.transceivers[0]!.sender,
    );
    rejected!.replaceTrack.mockRejectedValueOnce(new Error("sender closed"));
    const replacement = fakeTrack();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
      fakeStream(replacement),
    );

    await client.applySettings({ ...settings, inputDeviceId: "other-mic" });

    expect(accepted!.replaceTrack.mock.calls.map(([next]) => next)).toEqual([
      replacement,
      track,
    ]);
    expect(accepted!.track).toBe(track);
    expect(rejected!.track).toBe(track);
    expect(replacement.stop).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
    expect(client.getSnapshot().error).toMatchObject({
      kind: "mic-unavailable",
      recoverable: true,
    });
    client.dispose();
  });

  it("persists the default-device fallback when the active microphone ends", async () => {
    settings = { ...settings, inputDeviceId: "usb-mic" };
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);
    await client.join(CHANNEL);
    const replacement = fakeTrack();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
      fakeStream(replacement),
    );

    (track.onended as unknown as () => void)();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ inputDeviceId: null }),
    );
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    client.dispose();
  });

  it("reopens the system-default microphone when its physical route changes", async () => {
    const client = build();
    await client.join(CHANNEL);
    const replacement = fakeTrack();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
      fakeStream(replacement),
    );

    (track.onended as unknown as () => void)();

    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(replacement.stop).not.toHaveBeenCalled();
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("follows a changed system-default microphone on devicechange", async () => {
    enumeratedDevices = [mediaDevice("audioinput", "mic-a")];
    const client = build();
    await client.join(CHANNEL);
    await vi.waitFor(() => expect(deviceChangeListener).not.toBeNull());
    await Promise.resolve();

    const replacement = fakeTrack();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
      fakeStream(replacement),
    );
    enumeratedDevices = [mediaDevice("audioinput", "mic-b")];
    deviceChangeListener?.(new Event("devicechange"));

    await vi.waitFor(
      () => expect(track.stop).toHaveBeenCalled(),
      { timeout: 1_000 },
    );
    expect(replacement.stop).not.toHaveBeenCalled();
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    client.dispose();
  });

  it("persists a system-output fallback when a selected sink is unavailable", async () => {
    settings = { ...settings, outputDeviceId: "missing-headset" };
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);

    await joinWith(client, "u-z");

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ outputDeviceId: null }),
    );
    client.dispose();
  });

  it("reroutes active playback when a selected output is unplugged", async () => {
    const originalSetSinkId = HTMLMediaElement.prototype.setSinkId;
    const setSinkId = vi.fn(async () => undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: setSinkId,
    });
    settings = { ...settings, outputDeviceId: "usb-headphones" };
    enumeratedDevices = [mediaDevice("audiooutput", "usb-headphones")];
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);

    try {
      await joinWith(client, "u-z");
      await vi.waitFor(() => expect(deviceChangeListener).not.toBeNull());
      await vi.waitFor(() =>
        expect(setSinkId).toHaveBeenCalledWith("usb-headphones"),
      );
      setSinkId.mockClear();

      enumeratedDevices = [mediaDevice("audiooutput", "built-in-speakers")];
      deviceChangeListener?.(new Event("devicechange"));

      await vi.waitFor(
        () => expect(updateSettings).toHaveBeenCalledWith({ outputDeviceId: null }),
        { timeout: 1_000 },
      );
      await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledWith(""));
      expect(realtime.leaveVoice).not.toHaveBeenCalled();
    } finally {
      client.dispose();
      if (originalSetSinkId === undefined) {
        delete (
          HTMLMediaElement.prototype as unknown as {
            setSinkId?: HTMLMediaElement["setSinkId"];
          }
        ).setSinkId;
      } else {
        Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
          configurable: true,
          value: originalSetSinkId,
        });
      }
    }
  });

  it("mutes only the microphone, never shared audio", async () => {
    displayTracks = [fakeTrack("video"), fakeTrack("audio")];
    const client = build();
    await client.join(CHANNEL);
    await client.startScreenShare();

    client.setMuted(true);

    expect(track.enabled).toBe(false);
    // Shared system sound is content, not the person's voice.
    expect(displayTracks[1]?.enabled).toBe(true);
    client.dispose();
  });

  it("deafens remote voice sinks immediately and restores them", async () => {
    const client = build();
    await joinWith(client, "u-z");
    const sink = document.querySelector(
      "[data-stellarr-voice-audio] audio",
    ) as HTMLAudioElement;

    client.setDeafened(true);
    expect(sink.muted).toBe(true);

    client.setDeafened(false);
    expect(sink.muted).toBe(false);
    client.dispose();
  });
});

describe("WebRtcVoiceClient — screen share", () => {
  it("opens the picker with the selected capture ceiling", async () => {
    settings = { ...settings, screenShareQuality: "economy" };
    const client = build();
    await client.join(CHANNEL);
    await client.startScreenShare();

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          height: { max: 720 },
          frameRate: { max: 15 },
        }),
      }),
    );
    client.dispose();
  });

  it("adds screen tracks to every existing peer", async () => {
    displayTracks = [fakeTrack("video"), fakeTrack("audio")];
    const client = build();
    const pc = await joinWith(client, "u-z");
    const before = pc.transceivers.length;

    await client.startScreenShare();

    // Video plus the optional system audio.
    expect(pc.transceivers.length).toBe(before + 2);
    expect(client.getSnapshot().localScreen?.hasAudio).toBe(true);
    client.dispose();
  });

  it("works without system audio when the picker gave none", async () => {
    displayTracks = [fakeTrack("video")];
    const client = build();
    const pc = await joinWith(client, "u-z");
    const before = pc.transceivers.length;

    await client.startScreenShare();

    expect(pc.transceivers.length).toBe(before + 1);
    expect(client.getSnapshot().localScreen?.hasAudio).toBe(false);
    client.dispose();
  });

  it("keeps sharing video when the selected system-audio track ends", async () => {
    const video = fakeTrack("video");
    const audio = fakeTrack("audio");
    displayTracks = [video, audio];
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();
    const audioSender = pc.transceivers[2]!.sender;
    pc.signalingState = "stable";

    (audio.onended as unknown as () => void)();
    await vi.waitFor(() =>
      expect(client.getSnapshot().localScreen?.hasAudio).toBe(false),
    );

    expect(client.getSnapshot().localScreen?.stream).toBeDefined();
    expect(pc.removedSenders).toContain(audioSender);
    expect(video.stop).not.toHaveBeenCalled();
    client.dispose();
  });

  it("gives a peer that joins later the ongoing share", async () => {
    const client = build();
    await client.join(CHANNEL);
    await client.startScreenShare();

    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [{ userId: "u-z", displayName: "Z", muted: false }],
    });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));

    const pc = FakePeerConnection.instances[0]!;
    // Microphone + screen video.
    expect(pc.transceivers.length).toBe(2);
    client.dispose();
  });

  it("caps the screen encoding and holds resolution", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();

    const screenSender = pc.transceivers[1]?.sender;
    await vi.waitFor(() => expect(screenSender?.setParameters).toHaveBeenCalled());
    const applied = screenSender?.setParameters.mock.calls[0]?.[0] as
      RTCRtpSendParameters & { degradationPreference?: string };
    expect(applied.encodings[0]?.maxBitrate).toBe(2_500_000);
    expect(applied.encodings[0]?.maxFramerate).toBe(30);
    // Readable text beats smooth frames on a desktop.
    expect(applied.degradationPreference).toBe("maintain-resolution");
    client.dispose();
  });

  it("changes capture and compression parameters during an active share", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();
    const video = displayTracks[0]!;
    const screenSender = pc.transceivers[1]!.sender;

    await client.applySettings({ ...settings, screenShareQuality: "sharp" });

    expect(video.applyConstraints).toHaveBeenCalledWith({
      height: { max: 1440 },
      frameRate: { max: 30 },
    });
    const applied = screenSender.setParameters.mock.calls.at(-1)?.[0] as
      RTCRtpSendParameters;
    expect(applied.encodings[0]).toMatchObject({
      maxBitrate: 5_000_000,
      maxFramerate: 30,
      scalabilityMode: "L1T2",
      priority: "medium",
      networkPriority: "medium",
    });
    client.dispose();
  });

  it("falls back without temporal layering on an older WebRTC stack", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();
    const screenSender = pc.transceivers[1]!.sender;
    screenSender.setParameters.mockRejectedValueOnce(new Error("unsupported"));

    await client.applySettings({ ...settings, screenShareQuality: "ultra" });

    const fallback = screenSender.setParameters.mock.calls.at(-1)?.[0] as
      RTCRtpSendParameters;
    expect(fallback.encodings[0]).toMatchObject({
      maxBitrate: 12_000_000,
      maxFramerate: 60,
    });
    expect(fallback.encodings[0]).not.toHaveProperty("scalabilityMode");
    expect(client.getSnapshot().error).toBeNull();
    client.dispose();
  });

  it("prefers VP9 for the screen without dropping fallbacks", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();

    const preferences = pc.transceivers[1]?.setCodecPreferences;
    expect(preferences).toHaveBeenCalled();
    const ordered = preferences?.mock.calls[0]?.[0] as RTCRtpCodec[];
    expect(ordered[0]?.mimeType).toBe("video/VP9");
    expect(ordered).toHaveLength(2);
    client.dispose();
  });

  it("removes the senders and renegotiates when the share stops", async () => {
    displayTracks = [fakeTrack("video"), fakeTrack("audio")];
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();
    // The peer answered, so a fresh offer is possible.
    pc.signalingState = "stable";
    realtime.sent.length = 0;

    await client.stopScreenShare();

    expect(pc.removeTrack).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().localScreen).toBeNull();
    // Removing a sender needs a fresh offer.
    await vi.waitFor(() =>
      expect(realtime.sent.some((signal) => signal.kind === "offer")).toBe(true),
    );
    client.dispose();
  });

  it("stops the capture tracks so the browser's sharing bar goes away", async () => {
    const video = fakeTrack("video");
    displayTracks = [video];
    const client = build();
    await joinWith(client, "u-z");
    await client.startScreenShare();

    await client.stopScreenShare();
    expect(video.stop).toHaveBeenCalled();
    client.dispose();
  });

  it("stops exactly once when the browser's own Stop button ends it", async () => {
    const video = fakeTrack("video");
    displayTracks = [video];
    const client = build();
    const pc = await joinWith(client, "u-z");
    await client.startScreenShare();

    // Chromium fires `ended` on the track when the user stops from its bar.
    const onended = video.onended as unknown as () => void;
    onended();
    onended();
    await vi.waitFor(() => expect(client.getSnapshot().localScreen).toBeNull());

    // Idempotent: the second call must not remove anything a second time.
    expect(pc.removeTrack).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("reports a blocked share but treats cancelling as a non-event", async () => {
    const client = build();
    await joinWith(client, "u-z");

    (navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    await client.startScreenShare();
    // Pressing Escape is a decision, not an error worth showing.
    expect(client.getSnapshot().error).toBeNull();
    expect(client.getSnapshot().screenSharePending).toBe(false);

    (navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("Permission denied by system", "NotAllowedError"),
    );
    await client.startScreenShare();
    expect(client.getSnapshot().error?.kind).toBe("screen-share");
    expect(client.getSnapshot().error?.recoverable).toBe(true);
    client.dispose();
  });

  it("announces the screen msid so peers can classify the tracks", async () => {
    const client = build();
    await joinWith(client, "u-z");
    realtime.sent.length = 0;

    await client.startScreenShare();

    const state = realtime.sent.filter((signal) => signal.kind === "state").at(-1);
    expect(JSON.parse(state?.payload ?? "{}").screenStreamId).toEqual(expect.any(String));
    client.dispose();
  });
});

describe("WebRtcVoiceClient — camera", () => {
  function cameraStream(video: MediaStreamTrack): MediaStream {
    return fakeStream(video);
  }

  it("captures video-only from the selected camera and publishes it", async () => {
    settings = { ...settings, videoDeviceId: "camera-2" };
    const client = build();
    const pc = await joinWith(client, "u-z");
    const video = fakeTrack("video");
    const stream = cameraStream(video);
    (
      navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(stream);

    await client.startCamera();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: "camera-2" } }),
    });
    expect(client.getSnapshot().localCamera).toEqual({
      streamId: stream.id,
      stream,
    });
    expect(pc.transceivers[1]?.sender.track).toBe(video);
    expect(pc.transceivers[1]?.sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ degradationPreference: "maintain-framerate" }),
    );
    client.dispose();
  });

  it("opens the system camera when a persisted camera is gone", async () => {
    settings = { ...settings, videoDeviceId: "missing-usb-camera" };
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);
    await joinWith(client, "u-z");
    const fallbackVideo = fakeTrack("video");
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
      .mockResolvedValueOnce(cameraStream(fallbackVideo));

    await client.startCamera();

    expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null });
    expect(client.getSnapshot().localCamera?.stream).toBeDefined();
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("announces the camera msid independently from screen sharing", async () => {
    const client = build();
    await joinWith(client, "u-z");
    const stream = cameraStream(fakeTrack("video"));
    (
      navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(stream);
    realtime.sent.length = 0;

    await client.startCamera();

    const state = realtime.sent.filter((signal) => signal.kind === "state").at(-1);
    expect(JSON.parse(state?.payload ?? "{}")).toMatchObject({
      cameraStreamId: stream.id,
      screenStreamId: null,
    });
    client.dispose();
  });

  it("removes the sender and releases the device when camera is stopped", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const video = fakeTrack("video");
    (
      navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(cameraStream(video));
    await client.startCamera();
    pc.signalingState = "stable";

    await client.stopCamera();

    expect(pc.removeTrack).toHaveBeenCalledTimes(1);
    expect(video.stop).toHaveBeenCalled();
    expect(client.getSnapshot().localCamera).toBeNull();
    client.dispose();
  });

  it("keeps the call alive when camera permission is denied", async () => {
    const client = build();
    await joinWith(client, "u-z");
    (
      navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    await client.startCamera();

    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      cameraPending: false,
      localCamera: null,
      error: { kind: "camera", recoverable: true },
    });
    client.dispose();
  });

  it("switches the active device without leaving the call", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const first = cameraStream(fakeTrack("video"));
    const secondVideo = fakeTrack("video");
    const second = cameraStream(secondVideo);
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    getUserMedia.mockResolvedValueOnce(first);
    await client.startCamera();
    getUserMedia.mockResolvedValueOnce(second);

    await client.applySettings({ ...settings, videoDeviceId: "camera-2" });

    const sender = pc.transceivers[1]!.sender;
    expect(sender.replaceTrack).toHaveBeenCalledWith(secondVideo);
    expect(sender.setStreams).toHaveBeenCalledWith(second);
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    client.dispose();
  });

  it("falls back to the default camera when the active camera is unplugged", async () => {
    settings = { ...settings, videoDeviceId: "camera-usb" };
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);
    const pc = await joinWith(client, "u-z");
    const firstVideo = fakeTrack("video");
    const fallbackVideo = fakeTrack("video");
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    getUserMedia.mockResolvedValueOnce(cameraStream(firstVideo));
    await client.startCamera();
    getUserMedia.mockResolvedValueOnce(cameraStream(fallbackVideo));

    (firstVideo.onended as unknown as () => void)();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null }),
    );
    await vi.waitFor(() =>
      expect(pc.transceivers[1]?.sender.replaceTrack).toHaveBeenCalledWith(
        fallbackVideo,
      ),
    );
    expect(client.getSnapshot().connection).toBe("connected");
    expect(client.getSnapshot().localCamera?.stream).toBeDefined();
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    client.dispose();
  });

  it("applies a new camera quality to capture and sender without leaving", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const first = cameraStream(fakeTrack("video"));
    const secondVideo = fakeTrack("video");
    const second = cameraStream(secondVideo);
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    getUserMedia.mockResolvedValueOnce(first);
    await client.startCamera();
    const sender = pc.transceivers[1]!.sender;
    sender.setParameters.mockClear();
    getUserMedia.mockResolvedValueOnce(second);

    await client.applySettings({ ...settings, cameraQuality: "sharp" });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
      }),
    });
    expect(sender.replaceTrack).toHaveBeenCalledWith(secondVideo);
    expect(sender.setParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({
        encodings: [expect.objectContaining({ maxBitrate: 3_000_000 })],
      }),
    );
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    client.dispose();
  });
});

describe("WebRtcVoiceClient — remote media classification", () => {
  /**
   * Classification must not depend on arrival order. Screen audio routinely
   * beats both the microphone track and the peer's own announcement, and the
   * old "first audio stream is the microphone" rule mis-filed it onto the voice
   * element — then mis-filed the real voice as screen audio, permanently.
   */
  function emit(
    pc: FakePeerConnection,
    kind: "audio" | "video",
    stream: MediaStream,
  ) {
    const handler = pc.ontrack as unknown as (event: {
      track: MediaStreamTrack;
      streams: MediaStream[];
    }) => void;
    const track =
      kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    handler({ track: track ?? fakeTrack(kind), streams: [stream] });
  }

  function announceScreen(streamId: string | null) {
    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "state",
      payload: JSON.stringify({
        muted: false,
        screenStreamId: streamId,
        cameraStreamId: null,
      }),
    });
  }

  function announceCamera(streamId: string | null) {
    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "state",
      payload: JSON.stringify({
        muted: false,
        screenStreamId: null,
        cameraStreamId: streamId,
      }),
    });
  }

  /** Which stream is on which sink, in DOM order. */
  function sinks() {
    return [...document.querySelectorAll("audio")].map(
      (element) => (element as HTMLAudioElement).srcObject,
    );
  }

  function expectRouting(mic: MediaStream, screen: MediaStream | null) {
    const attached = sinks();
    expect(attached).toContain(mic);
    if (screen) {
      expect(attached).toContain(screen);
      // Exactly one element per logical source — never the same stream twice.
      expect(attached.filter((item) => item === screen)).toHaveLength(1);
    }
    expect(attached.filter((item) => item === mic)).toHaveLength(1);
  }

  it("mic first, then screen video and screen audio", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const mic = fakeStream(fakeTrack("audio"));
    const share = fakeStream(fakeTrack("video"), fakeTrack("audio"));
    emit(pc, "audio", mic);
    emit(pc, "video", share);
    emit(pc, "audio", share);

    expectRouting(mic, share);
    client.dispose();
  });

  it("screen audio first, before the video and before any microphone", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const share = fakeStream(fakeTrack("video"), fakeTrack("audio"));
    const mic = fakeStream(fakeTrack("audio"));

    // The pathological order: nothing yet identifies this as a share.
    emit(pc, "audio", share);
    emit(pc, "video", share);
    emit(pc, "audio", mic);

    // Once the video identifies the stream, the audio is moved off the voice
    // element rather than left there.
    expectRouting(mic, share);
    client.dispose();
  });

  it("state announcement before any track", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const share = fakeStream(fakeTrack("audio"));
    announceScreen(share.id);

    const mic = fakeStream(fakeTrack("audio"));
    emit(pc, "audio", share);
    emit(pc, "audio", mic);

    expectRouting(mic, share);
    client.dispose();
  });

  it("state announcement after both tracks", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const share = fakeStream(fakeTrack("audio"));
    const mic = fakeStream(fakeTrack("audio"));
    emit(pc, "audio", share);
    emit(pc, "audio", mic);
    // Both were plausible microphones until this arrives.
    announceScreen(share.id);

    expectRouting(mic, share);
    client.dispose();
  });

  it("classifies from the remote SDP before any track event fires", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    // The description names which msid carries video, and is applied first.
    pc.setRemoteDescription.mockImplementation(
      async (description: RTCSessionDescriptionInit) => {
        pc.remoteDescription = description;
        pc.signalingState = "stable";
      },
    );
    realtime.emit("VoiceSignal", {
      channelId: CHANNEL,
      fromUserId: "u-z",
      kind: "answer",
      payload: JSON.stringify({
        type: "answer",
        sdp: [
          "v=0",
          "m=audio 9 UDP/TLS/RTP/SAVPF 111",
          "a=mid:0",
          "a=msid:mic-stream mic-track",
          "a=rtpmap:111 opus/48000/2",
          "m=video 9 UDP/TLS/RTP/SAVPF 96",
          "a=mid:1",
          "a=msid:share-stream share-track",
          "a=rtpmap:96 VP9/90000",
          "m=audio 9 UDP/TLS/RTP/SAVPF 111",
          "a=mid:2",
          "a=msid:share-stream share-audio",
          "a=rtpmap:111 opus/48000/2",
          "",
        ].join("\r\n"),
      }),
    });
    await vi.waitFor(() => expect(pc.setRemoteDescription).toHaveBeenCalled());

    const share = fakeStreamWithId("share-stream", fakeTrack("audio"));
    const mic = fakeStreamWithId("mic-stream", fakeTrack("audio"));
    // Screen audio arrives first and there is still no video track, yet the
    // SDP already settled it.
    emit(pc, "audio", share);
    emit(pc, "audio", mic);

    expectRouting(mic, share);
    client.dispose();
  });

  it("never plays one stream through two sinks while re-routing", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const share = fakeStream(fakeTrack("video"), fakeTrack("audio"));
    emit(pc, "audio", share);
    emit(pc, "video", share);
    emit(pc, "audio", share);

    const attached = sinks();
    expect(attached.filter((item) => item === share)).toHaveLength(1);
    // The voice element is left empty rather than holding the share.
    expect(attached.filter((item) => item === null).length).toBeGreaterThanOrEqual(1);
    client.dispose();
  });

  it("exposes a remote share on the peer for the UI", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const screenStream = fakeStream(fakeTrack("video"));
    announceScreen(screenStream.id);
    emit(pc, "video", screenStream);

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.screen?.streamId).toBe(screenStream.id);
    expect(peer?.screen?.stream).toBe(screenStream);
    client.dispose();
  });

  it("reports screen audio on the peer once it is routed", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const share = fakeStream(fakeTrack("video"));
    announceScreen(share.id);
    emit(pc, "video", share);
    emit(pc, "audio", share);

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.screen?.hasAudio).toBe(true);
    client.dispose();
  });

  it("removes only remote screen audio when that track ends", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const video = fakeTrack("video");
    const audio = fakeTrack("audio");
    const share = fakeStream(video, audio);
    announceScreen(share.id);
    emit(pc, "video", share);
    emit(pc, "audio", share);

    (audio.onended as unknown as () => void)();

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.screen?.stream).toBe(share);
    expect(peer?.screen?.hasAudio).toBe(false);
    client.dispose();
  });

  it("detaches an ended remote microphone instead of retaining a dead sink", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const remoteTrack = fakeTrack("audio");
    const mic = fakeStream(remoteTrack);
    emit(pc, "audio", mic);
    expect(sinks()).toContain(mic);

    (remoteTrack.onended as unknown as () => void)();

    expect(sinks()).not.toContain(mic);
    client.dispose();
  });

  it("applies the viewer's participant volume to shared-screen audio", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const share = fakeStream(fakeTrack("video"), fakeTrack("audio"));
    announceScreen(share.id);
    emit(pc, "video", share);
    emit(pc, "audio", share);

    client.setPeerVolume("u-z", 40);
    const screenSink = [...document.querySelectorAll("audio")].find(
      (element) => (element as HTMLAudioElement).srcObject === share,
    ) as HTMLAudioElement | undefined;
    expect(screenSink?.volume).toBe(0.4);
    client.dispose();
  });

  it("clears the remote share when the track ends", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const videoTrack = fakeTrack("video");
    const screenStream = fakeStream(videoTrack);
    const handler = pc.ontrack as unknown as (event: {
      track: MediaStreamTrack;
      streams: MediaStream[];
    }) => void;
    announceScreen(screenStream.id);
    handler({ track: videoTrack, streams: [screenStream] });

    (videoTrack.onended as unknown as () => void)();

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.screen).toBeNull();
    client.dispose();
  });

  it("exposes a remote camera without mistaking it for a screen share", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const camera = fakeStream(fakeTrack("video"));

    emit(pc, "video", camera);
    announceCamera(camera.id);

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.camera).toEqual({ streamId: camera.id, stream: camera });
    expect(peer?.screen).toBeNull();
    client.dispose();
  });

  it("handles camera state arriving before the video track", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const camera = fakeStream(fakeTrack("video"));

    announceCamera(camera.id);
    emit(pc, "video", camera);

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.camera?.stream).toBe(camera);
    client.dispose();
  });

  it("does not reuse a stale ended camera stream for a later screen role", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const camera = fakeStream(fakeTrack("video"));
    emit(pc, "video", camera);
    announceCamera(camera.id);
    expect(
      client.getSnapshot().peers.find((item) => !item.self)?.camera,
    ).not.toBeNull();

    announceCamera(null);
    announceScreen(camera.id);

    const peer = client.getSnapshot().peers.find((item) => !item.self);
    expect(peer?.camera).toBeNull();
    expect(peer?.screen).toBeNull();
    client.dispose();
  });

  it("keeps the voice playing after a share ends", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    const mic = fakeStream(fakeTrack("audio"));
    const videoTrack = fakeTrack("video");
    const share = fakeStream(videoTrack, fakeTrack("audio"));
    emit(pc, "audio", mic);
    emit(pc, "video", share);
    emit(pc, "audio", share);

    (videoTrack.onended as unknown as () => void)();

    // The microphone element is untouched by the share ending.
    expect(sinks()).toContain(mic);
    client.dispose();
  });
});

describe("WebRtcVoiceClient — reconnect and lifecycle", () => {
  it("leaves cleanly when a newer tab replaces this voice session", async () => {
    const client = build();
    await joinWith(client, "u-z");

    realtime.emit("VoiceSessionReplaced", { channelId: CHANNEL });

    await vi.waitFor(() =>
      expect(client.getSnapshot().error?.kind).toBe("session-replaced"),
    );
    expect(client.getSnapshot().channelId).toBeNull();
    expect(realtime.leaveVoice).toHaveBeenCalled();
    client.dispose();
  });

  it("releases media when a moderator kicks this session from the channel", async () => {
    const client = build();
    await joinWith(client, "u-z");

    realtime.emit("VoiceChannelKicked", { channelId: CHANNEL });

    await vi.waitFor(() =>
      expect(client.getSnapshot().error?.kind).toBe("channel-kicked"),
    );
    expect(client.getSnapshot().channelId).toBeNull();
    expect(realtime.leaveVoice).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    client.dispose();
  });

  it("moves to an administrator-selected channel without recapturing media", async () => {
    const client = build();
    const oldPeer = await joinWith(client, "u-z");

    realtime.emit("VoiceChannelMoved", {
      fromChannelId: CHANNEL,
      toChannelId: TARGET_CHANNEL,
    });

    await vi.waitFor(() =>
      expect(client.getSnapshot().channelId).toBe(TARGET_CHANNEL),
    );
    expect(realtime.joinVoice).toHaveBeenLastCalledWith(TARGET_CHANNEL);
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(oldPeer.close).toHaveBeenCalled();
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("releases media when the other person declines a direct call", async () => {
    const client = build();
    await client.join(CHANNEL);

    realtime.emit("DirectCallDeclined", {
      channelId: CHANNEL,
      byUserId: "u-z",
    });

    await vi.waitFor(() => expect(client.getSnapshot().channelId).toBeNull());
    expect(realtime.leaveVoice).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    client.dispose();
  });

  it("shows reconnecting without tearing down healthy media", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    realtime.getStatus.mockReturnValue("reconnecting" as never);
    realtime.emitStatus();

    expect(client.getSnapshot().connection).toBe("reconnecting");
    // The peer connection is direct and still fine; nothing was closed.
    expect(pc.close).not.toHaveBeenCalled();
    client.dispose();
  });

  it("rejoins the voice group and reannounces on reconnected", async () => {
    const client = build();
    await joinWith(client, "u-z");
    realtime.joinVoice.mockClear();
    realtime.sent.length = 0;

    realtime.getStatus.mockReturnValue("reconnecting" as never);
    realtime.emitStatus();
    realtime.getStatus.mockReturnValue("connected" as never);
    realtime.emitStatus();

    await vi.waitFor(() => expect(realtime.joinVoice).toHaveBeenCalledWith(CHANNEL));
    await vi.waitFor(() =>
      expect(realtime.sent.some((signal) => signal.kind === "state")).toBe(true),
    );
    expect(client.getSnapshot().connection).toBe("connected");
    client.dispose();
  });

  it("reports a failed rejoin as recoverable rather than ending the call", async () => {
    const client = build();
    await joinWith(client, "u-z");
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub gone"));

    realtime.getStatus.mockReturnValue("reconnecting" as never);
    realtime.emitStatus();
    realtime.getStatus.mockReturnValue("connected" as never);
    realtime.emitStatus();

    await vi.waitFor(() => expect(client.getSnapshot().error?.recoverable).toBe(true));
    client.dispose();
  });

  it("repairs only unhealthy peers when the tab comes forward", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.emit("VoiceParticipantChanged", {
      channelId: CHANNEL,
      participants: [
        { userId: "u-x", displayName: "X", muted: false },
        { userId: "u-z", displayName: "Z", muted: false },
      ],
    });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));

    const [healthy, broken] = FakePeerConnection.instances;
    healthy!.connectionState = "connected";
    broken!.connectionState = "failed";

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(broken!.restartIce).toHaveBeenCalled());

    // Rebuilding a working connection would cause the glitch this avoids.
    expect(healthy!.restartIce).not.toHaveBeenCalled();
    client.dispose();
  });

  it("retries playback of remote audio after a background spell", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const handler = pc.ontrack as unknown as (event: {
      track: MediaStreamTrack;
      streams: MediaStream[];
    }) => void;
    handler({ track: fakeTrack("audio"), streams: [fakeStream(fakeTrack("audio"))] });

    const sink = document.querySelector("audio") as HTMLAudioElement;
    const play = vi.spyOn(sink, "play").mockResolvedValue(undefined);

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    client.dispose();
  });

  it("retries remote playback on the next user gesture", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");
    const handler = pc.ontrack as unknown as (event: {
      track: MediaStreamTrack;
      streams: MediaStream[];
    }) => void;
    const stream = fakeStream(fakeTrack("audio"));
    handler({ track: stream.getAudioTracks()[0]!, streams: [stream] });

    const sink = document.querySelector("audio") as HTMLAudioElement;
    const play = vi.spyOn(sink, "play").mockResolvedValue(undefined);

    document.dispatchEvent(new Event("pointerdown"));

    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    expect(sink.srcObject).toBe(stream);
    client.dispose();
  });

  it("does not leave the channel on an ordinary tab switch", async () => {
    const client = build();
    await joinWith(client, "u-z");

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();

    expect(client.getSnapshot().connection).toBe("connected");
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    client.dispose();
  });

  it("removes its lifecycle listeners on leave", async () => {
    const client = build();
    await joinWith(client, "u-z");
    await client.leave();

    const before = FakePeerConnection.instances.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(FakePeerConnection.instances).toHaveLength(before);
    client.dispose();
  });
});

describe("WebRtcVoiceClient — ICE recovery", () => {
  it("waits out a transient disconnect before intervening", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    pc.connectionState = "disconnected";
    (pc.onconnectionstatechange as unknown as () => void)();

    // ICE very often recovers unaided; restarting immediately would throw away
    // a connection that was about to come back.
    expect(pc.restartIce).not.toHaveBeenCalled();

    pc.connectionState = "connected";
    (pc.onconnectionstatechange as unknown as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(pc.restartIce).not.toHaveBeenCalled();
    client.dispose();
  });

  it("escalates to an ICE restart once the grace period lapses", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    pc.connectionState = "disconnected";
    (pc.onconnectionstatechange as unknown as () => void)();

    await vi.waitFor(() => expect(pc.restartIce).toHaveBeenCalled(), { timeout: 1000 });
    client.dispose();
  });

  it("tries to recover a failed peer before reporting anything", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    pc.connectionState = "failed";
    (pc.onconnectionstatechange as unknown as () => void)();

    await vi.waitFor(() => expect(pc.restartIce).toHaveBeenCalled());
    expect(client.getSnapshot().error).toBeNull();
    client.dispose();
  });

  it("surfaces a terminal transport error only after the attempts run out", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      pc.connectionState = "disconnected";
      (pc.onconnectionstatechange as unknown as () => void)();
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    pc.connectionState = "failed";
    (pc.onconnectionstatechange as unknown as () => void)();

    await vi.waitFor(() => expect(client.getSnapshot().error?.kind).toBe("transport"));
    expect(client.getSnapshot().error?.recoverable).toBe(true);
    client.dispose();
  });

  it("cancels the watchdog when the peer goes away", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    pc.connectionState = "disconnected";
    (pc.onconnectionstatechange as unknown as () => void)();

    realtime.emit("VoiceParticipantChanged", { channelId: CHANNEL, participants: [] });
    await vi.waitFor(() => expect(pc.close).toHaveBeenCalled());

    await new Promise((resolve) => setTimeout(resolve, 100));
    // A disposed peer must never be nudged after it is gone.
    expect(pc.restartIce).not.toHaveBeenCalled();
    client.dispose();
  });
});


describe("WebRtcVoiceClient — escalation is bounded end to end", () => {
  it("runs one chain of three attempts, not one per disconnected event", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    // Repeated `disconnected` transitions, as a flapping link produces.
    for (let i = 0; i < 5; i += 1) {
      pc.connectionState = "disconnected";
      (pc.onconnectionstatechange as unknown as () => void)();
    }

    // The grace is 50 ms in these tests; give the whole chain room to run.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Exactly the configured budget, however many events arrived.
    expect(pc.restartIce.mock.calls.length).toBe(3);
    client.dispose();
  });

  it("gives a recovered peer a fresh budget", async () => {
    const client = build();
    const pc = await joinWith(client, "u-z");

    pc.connectionState = "disconnected";
    (pc.onconnectionstatechange as unknown as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(pc.restartIce).toHaveBeenCalledTimes(1);

    pc.connectionState = "connected";
    (pc.onconnectionstatechange as unknown as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 150));
    // The chain was cancelled on recovery.
    expect(pc.restartIce).toHaveBeenCalledTimes(1);

    pc.connectionState = "disconnected";
    (pc.onconnectionstatechange as unknown as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(pc.restartIce.mock.calls.length).toBe(4);
    client.dispose();
  });
});
