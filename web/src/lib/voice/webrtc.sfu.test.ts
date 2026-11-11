import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { english } from "@/test/translators";

import type {
  MediaSignal,
  RealtimeClient,
  RealtimeEventMap,
  RealtimeEventName,
  RealtimeStatus,
  VoiceSignal,
} from "@/lib/realtime/types";
import {
  RTC_PROTOCOL_VERSION,
  type BrowserMediaSignalKind,
  type MediaServerSignalKind,
  type MediaTrack,
} from "@/lib/rtc/protocol";
import type { VoiceIceProvider } from "./iceSession";
import { RemoteVoiceMixer } from "./remoteMixer";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { SpeechDetector } from "./vad";
import { WebRtcVoiceClient } from "./webrtc";

const CHANNEL = "ch-salon";
const TARGET_CHANNEL = "ch-nocna-zmiana";
const SERVER_SDP = "v=0\r\ns=stellarr-media\r\n";
const GRACE_MS = 20;
const PAUSE_MS = 7;

// ---- fakes -----------------------------------------------------------------

/** What `new MediaStream([track])` makes; the directory builds one per track. */
class FakeMediaStream {
  static made = 0;
  readonly id: string;
  constructor(
    private readonly tracks: MediaStreamTrack[] = [],
    id?: string,
  ) {
    this.id = id ?? `made-${FakeMediaStream.made++}`;
  }
  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks.filter((track) => track.kind === "audio");
  getVideoTracks = () => this.tracks.filter((track) => track.kind === "video");
}

class FakeSender {
  parameters = { encodings: [{}] } as unknown as RTCRtpSendParameters;
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
  constructor(
    readonly sender: FakeSender,
    readonly kind: "audio" | "video",
    public direction: RTCRtpTransceiverDirection,
    public mid: string | null,
    readonly streamId: string | null,
  ) {}
}

interface Incoming {
  mid: string;
  track: MediaStreamTrack;
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  transceivers: FakeTransceiver[] = [];
  /** Tracks the next remote offer brings, on these sections. */
  incoming: Incoming[] = [];
  stats: unknown[] = [];

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack:
    | ((event: { track: MediaStreamTrack; streams: MediaStream[]; transceiver: FakeTransceiver }) => void)
    | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(public config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  addTrack = vi.fn(() => {
    throw new Error("a link to the media server publishes on transceivers of its own");
  });

  addTransceiver = vi.fn(
    (
      trackOrKind: MediaStreamTrack | "audio" | "video",
      init: { direction: RTCRtpTransceiverDirection; streams?: FakeMediaStream[] },
    ) => {
      const track = typeof trackOrKind === "string" ? null : trackOrKind;
      const kind = typeof trackOrKind === "string" ? trackOrKind : (track!.kind as "audio" | "video");
      const transceiver = new FakeTransceiver(
        new FakeSender(track),
        kind,
        init.direction,
        null,
        init.streams?.[0]?.id ?? null,
      );
      this.transceivers.push(transceiver);
      queueMicrotask(() => this.onnegotiationneeded?.());
      return transceiver;
    },
  );

  removeTrack = vi.fn((sender: FakeSender) => {
    const transceiver = this.transceivers.find((item) => item.sender === sender);
    if (transceiver) transceiver.direction = "inactive";
    sender.track = null;
    queueMicrotask(() => this.onnegotiationneeded?.());
  });

  getTransceivers = () => this.transceivers;
  getConfiguration = () => this.config;
  setConfiguration = vi.fn((next: RTCConfiguration) => {
    this.config = next;
  });

  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: this.describe() }));
  createAnswer = vi.fn(async () => ({ type: "answer" as const, sdp: this.describe() }));

  setLocalDescription = vi.fn(async (description?: RTCSessionDescriptionInit) => {
    if (description?.type === "rollback") {
      this.signalingState = "stable";
      return;
    }
    this.localDescription = description ?? null;
    // A browser gives a transceiver its mid when the offer that carries it is applied.
    this.transceivers.forEach((transceiver, index) => {
      transceiver.mid ??= String(index);
    });
    this.signalingState = description?.type === "offer" ? "have-local-offer" : "stable";
  });

  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    if (description.type !== "offer") return;
    // Track events fire while the offer is applied, one per new section.
    for (const { mid, track } of this.incoming.splice(0)) {
      const transceiver = new FakeTransceiver(
        new FakeSender(null),
        track.kind as "audio" | "video",
        "recvonly",
        mid,
        null,
      );
      this.transceivers.push(transceiver);
      this.ontrack?.({ track, streams: [], transceiver });
    }
  });

  addIceCandidate = vi.fn(async () => {});
  restartIce = vi.fn();
  getStats = vi.fn(async () => this.stats);
  close = vi.fn(() => {
    this.connectionState = "closed";
  });

  setState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** A description with one section per transceiver, in the shape a browser writes. */
  private describe(): string {
    const lines = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0"];
    this.transceivers.forEach((transceiver, index) => {
      const audio = transceiver.kind === "audio";
      lines.push(`m=${transceiver.kind} 9 UDP/TLS/RTP/SAVPF ${audio ? "111" : "96"}`);
      lines.push(`a=mid:${transceiver.mid ?? String(index)}`);
      lines.push(`a=${transceiver.direction}`);
      if (transceiver.streamId) lines.push(`a=msid:${transceiver.streamId} track-${index}`);
      if (audio) {
        lines.push("a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1");
      } else {
        lines.push("a=rtpmap:96 VP8/90000");
      }
    });
    return `${lines.join("\r\n")}\r\n`;
  }
}

class FakeRealtime implements RealtimeClient {
  sent: VoiceSignal[] = [];
  media: Array<MediaSignal<BrowserMediaSignalKind>> = [];
  /** Hub calls in the order they were made. */
  calls: string[] = [];
  sessions = 0;
  status: RealtimeStatus = "connected";
  private handlers = new Map<RealtimeEventName, Array<(payload: never) => void>>();
  private statusListeners: Array<() => void> = [];

  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  getStatus = vi.fn(() => this.status);
  subscribeStatus = vi.fn((listener: () => void) => {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((item) => item !== listener);
    };
  });
  setPresence = vi.fn(async () => {});
  joinChannel = vi.fn(async () => {});
  sendTyping = vi.fn(async () => {});
  joinVoice = vi.fn(async (channelId: string) => {
    this.calls.push(`JoinVoice ${channelId}`);
  });
  leaveVoice = vi.fn(async () => {
    this.calls.push("LeaveVoice");
  });
  declineDirectCall = vi.fn(async () => {});
  sendVoiceSignal = vi.fn(async (signal: VoiceSignal) => {
    this.sent.push(signal);
  });
  openMediaSession = vi.fn(async (channelId: string) => {
    this.sessions += 1;
    this.calls.push(`OpenMediaSession ${channelId}`);
    return `media-session-${this.sessions}`;
  });
  sendMediaSignal = vi.fn(async (signal: MediaSignal<BrowserMediaSignalKind>) => {
    this.media.push(signal);
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
    return () => {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((item) => item !== handler),
      );
    };
  }

  emit<E extends RealtimeEventName>(event: E, payload: RealtimeEventMap[E]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (value: RealtimeEventMap[E]) => void)(payload);
    }
  }

  setStatus(status: RealtimeStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }

  mediaOfKind(kind: BrowserMediaSignalKind): Array<MediaSignal<BrowserMediaSignalKind>> {
    return this.media.filter((signal) => signal.kind === kind);
  }
}

/** Records how often a session is refreshed versus read per connection. */
class FakeIceProvider implements VoiceIceProvider {
  next: RTCIceServer[] = ICE;
  private session: RTCIceServer[] = [];
  beginSession = vi.fn(async () => {
    this.session = this.next;
    return this.session;
  });
  current = vi.fn(() => this.session);
  endSession = vi.fn(() => {
    this.session = [];
  });
}

function fakeTrack(kind: "audio" | "video" = "audio", channelCount = 1): MediaStreamTrack {
  return {
    kind,
    id: `${kind}-track-${trackCounter++}`,
    enabled: true,
    contentHint: "",
    stop: vi.fn(),
    onended: null,
    getSettings: () => ({ channelCount }),
    applyConstraints: vi.fn(async () => {}),
  } as unknown as MediaStreamTrack;
}

let trackCounter = 0;

const ICE: RTCIceServer[] = [
  { urls: ["stun:orbit.example:3478"] },
  {
    urls: ["turn:orbit.example:3478?transport=udp"],
    username: "4102444800:abc",
    credential: "secret==",
  },
];

let realtime: FakeRealtime;
let ice: FakeIceProvider;
let micTrack: MediaStreamTrack;
let settings: VoiceSettings;
let getUserMedia: ReturnType<typeof vi.fn>;
let getDisplayMedia: ReturnType<typeof vi.fn>;
let clients: WebRtcVoiceClient[];

function build(topology = "sfu"): WebRtcVoiceClient {
  const client = new WebRtcVoiceClient({
    realtime,
    selfUserId: "u-a",
    selfDisplayName: "Ja",
    ice,
    translate: english,
    rtc: { protocolVersion: RTC_PROTOCOL_VERSION, topology },
    getSettings: () => settings,
    statsIntervalMs: 60_000,
    recoveryGraceMs: GRACE_MS,
    mediaReplacementPauseMs: PAUSE_MS,
  });
  clients.push(client);
  return client;
}

function latestConnection(): FakePeerConnection {
  const pc = FakePeerConnection.instances.at(-1);
  if (!pc) throw new Error("no connection was made");
  return pc;
}

/** Join, which opens the media session and sends the first offer. */
async function joined(client: WebRtcVoiceClient): Promise<FakePeerConnection> {
  await client.join(CHANNEL);
  return latestConnection();
}

function announce(...people: Array<string | { userId: string; muted: boolean }>): void {
  realtime.emit("VoiceParticipantChanged", {
    channelId: CHANNEL,
    participants: people.map((person) =>
      typeof person === "string"
        ? { userId: person, displayName: `Osoba ${person}`, muted: false }
        : { ...person, displayName: `Osoba ${person.userId}` },
    ),
  });
}

function currentSession(): string {
  return `media-session-${realtime.sessions}`;
}

function fromServer(
  kind: MediaServerSignalKind,
  payload: unknown,
  sessionId = currentSession(),
  channelId = CHANNEL,
): void {
  realtime.emit("MediaSignal", {
    protocolVersion: RTC_PROTOCOL_VERSION,
    channelId,
    sessionId,
    kind,
    payload: JSON.stringify(payload),
  });
}

/** The media server answers this side's offer. */
async function answerOffer(pc: FakePeerConnection): Promise<void> {
  fromServer("answer", { type: "answer", sdp: SERVER_SDP });
  await vi.waitFor(() => expect(pc.signalingState).toBe("stable"));
}

type Forwarded = MediaTrack & { track?: MediaStreamTrack };

/** The media server offers what it forwards; each entry with a track brings that track. */
async function serverOffer(
  pc: FakePeerConnection,
  negotiationId: number,
  forwarded: Forwarded[],
): Promise<void> {
  const before = realtime.mediaOfKind("answer").length;
  pc.incoming.push(
    ...forwarded.flatMap(({ mid, track }) => (track ? [{ mid, track }] : [])),
  );
  fromServer("offer", {
    type: "offer",
    sdp: SERVER_SDP,
    negotiationId,
    tracks: forwarded.map(({ mid, userId, kind, streamId }) => ({ mid, userId, kind, streamId })),
  });
  await vi.waitFor(() => expect(realtime.mediaOfKind("answer")).toHaveLength(before + 1));
}

function tracks(list: MediaTrack[]): void {
  fromServer("tracks", { tracks: list });
}

function state(
  fromUserId: string,
  payload: { muted?: boolean; screenStreamId?: string | null; cameraStreamId?: string | null },
): void {
  realtime.emit("VoiceSignal", {
    protocolVersion: RTC_PROTOCOL_VERSION,
    channelId: CHANNEL,
    fromUserId,
    kind: "state",
    payload: JSON.stringify({
      muted: payload.muted ?? false,
      screenStreamId: payload.screenStreamId ?? null,
      cameraStreamId: payload.cameraStreamId ?? null,
    }),
  });
}

function peerOf(client: WebRtcVoiceClient, userId: string) {
  return client.getSnapshot().peers.find((peer) => peer.userId === userId);
}

function payloadOf(signal: MediaSignal<BrowserMediaSignalKind> | undefined) {
  return JSON.parse(signal?.payload ?? "null") as { type: string; sdp: string; negotiationId?: number };
}

/** The Opus parameters of the section `mid` in `sdp`. */
function fmtpOf(sdp: string, mid: string): string {
  const sections = sdp.split(/\r\n(?=m=)/);
  const section = sections.find((part) => part.includes(`a=mid:${mid}\r\n`)) ?? "";
  return /a=fmtp:111 (.*)/.exec(section)?.[1] ?? "";
}

/** The tracks each person's voice strips (or shared-sound strips) were given to play. */
function attachedTracks(
  attach: MockInstance<RemoteVoiceMixer["attach"]>,
  role: "voice" | "shared",
): Map<string, MediaStreamTrack[]> {
  const byPerson = new Map<string, MediaStreamTrack[]>();
  for (const [userId, stream, , , options] of attach.mock.calls) {
    if ((options === undefined) !== (role === "shared")) continue;
    byPerson.set(userId, [...(byPerson.get(userId) ?? []), ...stream.getTracks()]);
  }
  return byPerson;
}

async function sampleStats(client: WebRtcVoiceClient): Promise<void> {
  await (client as unknown as { sampleStats(): Promise<void> }).sampleStats();
}

function outbound(packets: number) {
  return { type: "outbound-rtp", kind: "audio", packetsSent: packets, bytesSent: packets * 80 };
}

function inbound(mid: string, packets: number) {
  return {
    type: "inbound-rtp",
    kind: "audio",
    mid,
    packetsReceived: packets,
    bytesReceived: packets * 80,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  FakeMediaStream.made = 0;
  trackCounter = 0;
  clients = [];
  realtime = new FakeRealtime();
  ice = new FakeIceProvider();
  micTrack = fakeTrack();
  settings = { ...DEFAULT_SETTINGS };
  getUserMedia = vi.fn(async () => new FakeMediaStream([micTrack], "mic-a"));
  getDisplayMedia = vi.fn(
    async () => new FakeMediaStream([fakeTrack("video"), fakeTrack("audio", 2)], "screen-a"),
  );
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      getDisplayMedia,
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  for (const client of clients) client.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("joining", () => {
  it("joins the seat, opens a media session, then offers on one bundled connection", async () => {
    const client = build();

    const pc = await joined(client);

    expect(realtime.calls).toEqual([`JoinVoice ${CHANNEL}`, `OpenMediaSession ${CHANNEL}`]);
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(pc.config).toMatchObject({ iceServers: ICE, bundlePolicy: "max-bundle" });
    expect(pc.addTrack).not.toHaveBeenCalled();
    expect(pc.addTransceiver).toHaveBeenCalledWith(micTrack, {
      direction: "sendonly",
      streams: [expect.objectContaining({ id: "mic-a" })],
    });
    expect(realtime.media).toHaveLength(1);
    const [offer] = realtime.media;
    expect(offer).toMatchObject({
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: CHANNEL,
      sessionId: "media-session-1",
      kind: "offer",
    });
    expect(payloadOf(offer).type).toBe("offer");
    // The Opus profile goes into the offer: the media server repeats it back,
    // which is what sets this side's encoder.
    expect(fmtpOf(payloadOf(offer).sdp, "0")).toContain("maxaveragebitrate=128000");
    expect(payloadOf(offer)).not.toHaveProperty("negotiationId");
    expect(realtime.sendVoiceSignal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "state" }),
    );
  });

  it("starts connecting, not ready: the media server has to be reached first", async () => {
    const client = build();

    await joined(client);

    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      transport: { signaling: "connected", media: "connecting", peerCount: 0 },
    });
  });

  it("sends its candidates and the end-of-candidates marker, one at a time, after the offer", async () => {
    const client = build();
    const pc = await joined(client);

    pc.onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: "candidate:1", sdpMid: "0" }) } as RTCIceCandidate,
    });
    pc.onicecandidate?.({ candidate: null });

    await vi.waitFor(() => expect(realtime.mediaOfKind("candidate")).toHaveLength(2));
    expect(realtime.media.map((signal) => signal.kind)).toEqual(["offer", "candidate", "candidate"]);
    const [candidate, end] = realtime.mediaOfKind("candidate");
    expect(JSON.parse(candidate!.payload)).toMatchObject({ candidate: "candidate:1" });
    expect(end?.payload).toBe("null");
    expect(end?.sessionId).toBe("media-session-1");
  });

  it("refuses an unknown topology before opening a device or a session", async () => {
    const client = build("quantum");

    await client.join(CHANNEL);

    expect(client.getSnapshot()).toMatchObject({
      connection: "failed",
      transport: { media: "failed" },
      error: { kind: "unsupported" },
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(realtime.joinVoice).not.toHaveBeenCalled();
    expect(realtime.openMediaSession).not.toHaveBeenCalled();
  });

  it("refuses a missing topology, which reaches it as unknown", async () => {
    const client = build("unknown");

    await client.join(CHANNEL);

    expect(client.getSnapshot().error?.kind).toBe("unsupported");
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("builds nothing for a session that opens after the call was left", async () => {
    const opening = deferred<string>();
    realtime.openMediaSession.mockReturnValueOnce(opening.promise);
    const client = build();

    const joining = client.join(CHANNEL);
    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalled());
    await client.leave();
    opening.resolve("media-session-1");
    await joining;

    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(realtime.media).toHaveLength(0);
  });

  it("leaves cleanly: closes the connection, stops the microphone, tells the hub", async () => {
    const client = build();
    const pc = await joined(client);

    await client.leave();

    expect(pc.close).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(realtime.leaveVoice).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({ connection: "idle", channelId: null, peers: [] });
  });
});

describe("negotiation", () => {
  it("answers the media server's offer and echoes its negotiationId", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);

    await serverOffer(pc, 7, []);

    const answer = realtime.mediaOfKind("answer")[0];
    expect(answer?.sessionId).toBe("media-session-1");
    expect(payloadOf(answer)).toMatchObject({ type: "answer", negotiationId: 7 });
    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: SERVER_SDP });
  });

  it("ignores a media server offer while its own offer is unanswered, and answers the next", async () => {
    const client = build();
    const pc = await joined(client);
    const voice = fakeTrack();
    announce("u-b");

    pc.incoming.push({ mid: "b1", track: voice });
    fromServer("offer", {
      type: "offer",
      sdp: SERVER_SDP,
      negotiationId: 1,
      tracks: [{ mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(realtime.mediaOfKind("answer")).toHaveLength(0);
    expect(pc.signalingState).toBe("have-local-offer");
    expect(pc.remoteDescription).toBeNull();

    // The media server answers this side, then offers again with a new number.
    await answerOffer(pc);
    await serverOffer(pc, 2, [{ mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b" }]);

    expect(realtime.mediaOfKind("answer").map((signal) => payloadOf(signal).negotiationId)).toEqual([2]);
  });

  it("does not lose its own offer when it is wanted while a media server offer is applied", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    const applying = deferred<void>();
    pc.setRemoteDescription.mockImplementationOnce(async (description) => {
      pc.remoteDescription = description;
      pc.signalingState = "have-remote-offer";
      await applying.promise;
    });

    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 3, tracks: [] });
    await vi.waitFor(() => expect(pc.signalingState).toBe("have-remote-offer"));
    const changing = client.applySettings({ ...settings, opusProfile: "studio" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(realtime.mediaOfKind("offer")).toHaveLength(1);

    applying.resolve();
    await changing;

    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    expect(realtime.media.slice(1).map((signal) => signal.kind)).toEqual(["answer", "offer"]);
    expect(fmtpOf(payloadOf(realtime.mediaOfKind("offer")[1]).sdp, "0")).toContain(
      "maxaveragebitrate=256000",
    );
  });

  it("drops a signal and a closure that name another session", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);

    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 1, tracks: [] }, "media-session-0");
    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 1, tracks: [] }, currentSession(), "ch-other");
    realtime.emit("MediaSessionClosed", {
      channelId: CHANNEL,
      sessionId: "media-session-0",
      reason: "error",
    });
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 3));

    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(realtime.mediaOfKind("answer")).toHaveLength(0);
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it("replaces a session at once when the browser refuses the media server's offer", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    pc.setRemoteDescription.mockRejectedValueOnce(new Error("m-lines out of order"));

    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 4, tracks: [] });

    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalledTimes(2));
    expect(pc.close).toHaveBeenCalled();
  });
});

describe("the directory", () => {
  function playback() {
    const attach = vi.spyOn(RemoteVoiceMixer.prototype, "attach").mockReturnValue(true);
    vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockResolvedValue(true);
    const remove = vi.spyOn(RemoteVoiceMixer.prototype, "remove");
    return { attach, remove };
  }

  async function ready() {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    return { client, pc };
  }

  it("files each arriving track under the person the directory names", async () => {
    const { attach } = playback();
    const { pc } = await ready();
    announce("u-b", "u-c");
    const voiceB = fakeTrack();
    const voiceC = fakeTrack();

    await serverOffer(pc, 1, [
      { mid: "c1", userId: "u-c", kind: "audio", streamId: "mic-c", track: voiceC },
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voiceB },
    ]);

    const voices = attachedTracks(attach, "voice");
    expect(voices.get("u-b")).toEqual([voiceB]);
    expect(voices.get("u-c")).toEqual([voiceC]);
  });

  it("holds a track whose section the directory does not name yet", async () => {
    const { attach } = playback();
    const { pc } = await ready();
    announce("u-b");
    const voice = fakeTrack();
    pc.incoming.push({ mid: "b1", track: voice });

    // The offer brings the track, but its directory names nothing.
    await serverOffer(pc, 1, []);
    expect(attachedTracks(attach, "voice").get("u-b")).toBeUndefined();

    tracks([{ mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b" }]);

    await vi.waitFor(() => expect(attachedTracks(attach, "voice").get("u-b")).toEqual([voice]));
  });

  it("holds an entry whose person the occupancy snapshot does not name yet", async () => {
    const { attach } = playback();
    const { client, pc } = await ready();
    const voice = fakeTrack();

    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice },
    ]);
    expect(attachedTracks(attach, "voice").get("u-b")).toBeUndefined();
    expect(peerOf(client, "u-b")).toBeUndefined();

    announce("u-b");

    await vi.waitFor(() => expect(attachedTracks(attach, "voice").get("u-b")).toEqual([voice]));
    expect(peerOf(client, "u-b")).toBeDefined();
  });

  it("stops playing a person the snapshot no longer lists, even while the directory does", async () => {
    const { attach, remove } = playback();
    const { client, pc } = await ready();
    announce("u-b");
    const voice = fakeTrack();
    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice },
    ]);
    attach.mockClear();

    announce();
    tracks([{ mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remove).toHaveBeenCalledWith("u-b");
    expect(attach).not.toHaveBeenCalled();
    expect(peerOf(client, "u-b")).toBeUndefined();
    expect(voice.onended).toBeNull();
  });

  it("stops playing a track the directory withdraws, though the track never ends", async () => {
    const { remove } = playback();
    const { client, pc } = await ready();
    announce("u-b");
    const face = fakeTrack("video");
    state("u-b", { cameraStreamId: "cam-b" });
    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
      { mid: "b2", userId: "u-b", kind: "video", streamId: "cam-b", track: face },
    ]);
    expect(peerOf(client, "u-b")?.camera?.streamId).toBe("cam-b");

    await serverOffer(pc, 2, []);

    expect(peerOf(client, "u-b")?.camera).toBeNull();
    expect(remove).toHaveBeenCalledWith("u-b");
  });

  it("follows a tracks update that changes a stream id, with no new description", async () => {
    playback();
    const { client, pc } = await ready();
    announce("u-b");
    const face = fakeTrack("video");
    state("u-b", { cameraStreamId: "cam-1" });
    await serverOffer(pc, 1, [
      { mid: "b2", userId: "u-b", kind: "video", streamId: "cam-1", track: face },
    ]);
    expect(peerOf(client, "u-b")?.camera?.streamId).toBe("cam-1");

    // The person swapped cameras: their state frame names the new stream, and
    // the media server says which section now carries it.
    state("u-b", { cameraStreamId: "cam-2" });
    tracks([{ mid: "b2", userId: "u-b", kind: "video", streamId: "cam-2" }]);

    await vi.waitFor(() => expect(peerOf(client, "u-b")?.camera?.streamId).toBe("cam-2"));
    expect(peerOf(client, "u-b")?.camera?.stream?.getTracks()).toEqual([face]);
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(2);
  });

  it("tells camera, screen and microphone apart by the state frame and the directory's ids", async () => {
    const { attach } = playback();
    const { client, pc } = await ready();
    announce("u-b");
    const voice = fakeTrack();
    const face = fakeTrack("video");
    const picture = fakeTrack("video");
    const sound = fakeTrack("audio", 2);
    state("u-b", { cameraStreamId: "cam-b", screenStreamId: "scr-b" });

    // Sound before picture, and section order that says nothing.
    await serverOffer(pc, 1, [
      { mid: "s2", userId: "u-b", kind: "audio", streamId: "scr-b", track: sound },
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice },
      { mid: "b2", userId: "u-b", kind: "video", streamId: "cam-b", track: face },
      { mid: "s1", userId: "u-b", kind: "video", streamId: "scr-b", track: picture },
    ]);

    const peer = peerOf(client, "u-b");
    expect(peer?.camera?.stream?.getTracks()).toEqual([face]);
    expect(peer?.screen).toMatchObject({ streamId: "scr-b", hasAudio: true });
    expect(peer?.screen?.stream?.getTracks()).toEqual([picture]);
    expect(attachedTracks(attach, "voice").get("u-b")).toEqual([voice]);
    expect(attachedTracks(attach, "shared").get("u-b")).toEqual([sound]);
  });

  it("asks for stereo on somebody's shared sound, and mono speech on their voice", async () => {
    playback();
    const { pc } = await ready();
    announce("u-b");

    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
      { mid: "s1", userId: "u-b", kind: "video", streamId: "scr-b", track: fakeTrack("video") },
      { mid: "s2", userId: "u-b", kind: "audio", streamId: "scr-b", track: fakeTrack() },
    ]);

    const { sdp } = payloadOf(realtime.mediaOfKind("answer")[0]);
    expect(fmtpOf(sdp, "s2")).toContain("stereo=1");
    expect(fmtpOf(sdp, "s2")).toContain("maxaveragebitrate=160000");
    expect(fmtpOf(sdp, "b1")).toContain("stereo=0");
  });

  it("keeps every per-person control on the receiving side", async () => {
    const { attach } = playback();
    const setVolume = vi
      .spyOn(RemoteVoiceMixer.prototype, "setVolume")
      .mockImplementation(() => undefined);
    const setGate = vi.spyOn(RemoteVoiceMixer.prototype, "setGate").mockResolvedValue(true);
    const setSuppressor = vi
      .spyOn(RemoteVoiceMixer.prototype, "setSuppressor")
      .mockResolvedValue(true);
    const listen = vi.spyOn(SpeechDetector.prototype, "add");
    const { client, pc } = await ready();
    announce("u-b");
    const voice = fakeTrack();
    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice },
    ]);

    client.setPeerVolume("u-b", 150);
    client.setPeerGate("u-b", true);
    client.setPeerSuppression("u-b", true);

    expect(attach).toHaveBeenCalledWith("u-b", expect.anything(), expect.anything(), 100, {
      gated: false,
      suppressed: false,
    });
    expect(setVolume).toHaveBeenCalledWith("u-b", 150);
    expect(setGate).toHaveBeenCalledWith("u-b", true);
    expect(setSuppressor).toHaveBeenCalledWith("u-b", true);
    expect(listen).toHaveBeenCalledWith(
      "u-b",
      expect.objectContaining({ getTracks: expect.any(Function) }),
    );
    expect(peerOf(client, "u-b")).toMatchObject({ playbackVolume: 150, gated: true, suppressed: true });
  });

  it("tells a newcomer where this side stands", async () => {
    const { client } = await ready();
    realtime.sent = [];

    announce("u-b");

    await vi.waitFor(() =>
      expect(realtime.sent).toContainEqual(
        expect.objectContaining({ kind: "state", toUserId: "u-b" }),
      ),
    );
    expect(client.getSnapshot().transport.peerCount).toBe(1);
  });
});

describe("publishing on the one connection", () => {
  it("publishes the camera on a send-only section of its own and offers it", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    const face = fakeTrack("video");
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([face], "cam-a"));

    await client.startCamera();

    expect(pc.addTransceiver).toHaveBeenLastCalledWith(face, {
      direction: "sendonly",
      streams: [expect.objectContaining({ id: "cam-a" })],
    });
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    expect(payloadOf(realtime.mediaOfKind("offer")[1]).sdp).toContain("a=msid:cam-a");
    expect(realtime.sent).toContainEqual(
      expect.objectContaining({ kind: "state", payload: expect.stringContaining('"cameraStreamId":"cam-a"') }),
    );
  });

  it("gives a share's sound its own stereo profile in the very offer that first carries it", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);

    await client.startScreenShare();

    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    const { sdp } = payloadOf(realtime.mediaOfKind("offer")[1]);
    // Section 0 is the microphone, 1 the share's picture, 2 its sound.
    expect(fmtpOf(sdp, "0")).toContain("stereo=0");
    expect(fmtpOf(sdp, "0")).toContain("maxaveragebitrate=128000");
    expect(fmtpOf(sdp, "2")).toContain("stereo=1");
    expect(fmtpOf(sdp, "2")).toContain("maxaveragebitrate=160000");
  });

  it("withdraws the share by turning its sections inactive and offering again", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    await client.startScreenShare();
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    await answerOffer(pc);

    await client.stopScreenShare();

    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(3));
    expect(pc.transceivers.slice(1).map((transceiver) => transceiver.direction)).toEqual([
      "inactive",
      "inactive",
    ]);
  });

  it("swaps the microphone with replaceTrack, keeping the session", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    const next = fakeTrack();
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([next], "mic-a2"));

    await client.applySettings({ ...settings, inputDeviceId: "usb-mic" });

    expect(pc.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(next);
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
    expect(micTrack.stop).toHaveBeenCalled();
  });

  it("caps the one microphone sender at the profile's ceiling", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);

    await client.applySettings({ ...settings, opusProfile: "studio" });

    expect(pc.transceivers[0]?.sender.parameters.encodings[0]?.maxBitrate).toBe(256_000);
  });

  it("offers to receive when it has nothing to publish", async () => {
    const client = build();
    await client.join(CHANNEL);
    const before = FakePeerConnection.instances.length;
    // Something else took the microphone away between sessions.
    (client as unknown as { releaseMicrophone(): void }).releaseMicrophone();

    realtime.emit("MediaSessionClosed", { channelId: CHANNEL, sessionId: currentSession(), reason: "error" });

    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(before + 1));
    expect(latestConnection().addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
  });
});

describe("the state of the one connection", () => {
  /** Join, seat `occupants`, forward `forwarded`, and bring the connection up. */
  async function connected(
    client: WebRtcVoiceClient,
    occupants: Array<string | { userId: string; muted: boolean }> = [],
    forwarded: Forwarded[] = [],
  ) {
    const pc = await joined(client);
    if (occupants.length > 0) announce(...occupants);
    await answerOffer(pc);
    if (forwarded.length > 0) await serverOffer(pc, 1, forwarded);
    pc.setState("connected");
    return pc;
  }

  it("is connecting while the connection is up but nothing has been sent", async () => {
    const client = build();
    await connected(client);

    expect(client.getSnapshot().transport).toMatchObject({ media: "connecting", peerCount: 0 });
  });

  it("is ready once its own audio is proven and nobody else is there", async () => {
    const client = build();
    const pc = await connected(client);
    pc.stats = [outbound(10)];

    await sampleStats(client);

    expect(client.getSnapshot().transport).toEqual({
      signaling: "connected",
      media: "ready",
      peerCount: 0,
      connectedPeerCount: 0,
    });
  });

  it("is connected when every other person's microphone arrives", async () => {
    const client = build();
    const pc = await connected(client, ["u-b"], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 10)];

    await sampleStats(client);

    expect(client.getSnapshot().transport).toMatchObject({
      media: "connected",
      peerCount: 1,
      connectedPeerCount: 1,
    });
  });

  it("is degraded when some microphones do not arrive, and proves each round afresh", async () => {
    const client = build();
    const pc = await connected(client, ["u-b", "u-c"], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
      { mid: "c1", userId: "u-c", kind: "audio", streamId: "mic-c", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 10), inbound("c1", 0)];

    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({
      media: "degraded",
      peerCount: 2,
      connectedPeerCount: 1,
    });

    pc.stats = [outbound(20), inbound("b1", 10), inbound("c1", 8)];
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({ media: "degraded", connectedPeerCount: 1 });

    pc.stats = [outbound(30), inbound("b1", 15), inbound("c1", 16)];
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({ media: "connected", connectedPeerCount: 2 });
  });

  it("excuses a muted person from sending, as v1 does", async () => {
    const client = build();
    const pc = await connected(client, [{ userId: "u-b", muted: true }], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 0)];

    await sampleStats(client);

    expect(client.getSnapshot().transport).toMatchObject({ media: "connected", connectedPeerCount: 1 });
  });

  it("does not count a microphone it has not been given a section for", async () => {
    const client = build();
    const pc = await connected(client, [{ userId: "u-b", muted: true }]);
    pc.stats = [outbound(10)];

    await sampleStats(client);

    expect(client.getSnapshot().transport).toMatchObject({
      media: "degraded",
      peerCount: 1,
      connectedPeerCount: 0,
    });
  });

  it("is degraded while the connection is being recovered", async () => {
    const client = build();
    const pc = await connected(client);
    pc.stats = [outbound(10)];
    await sampleStats(client);
    realtime.openMediaSession.mockReturnValueOnce(new Promise(() => {}));

    realtime.emit("MediaSessionClosed", {
      channelId: CHANNEL,
      sessionId: "media-session-1",
      reason: "transport-timeout",
    });

    expect(client.getSnapshot().transport.media).toBe("degraded");
    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalledTimes(2));
    expect(client.getSnapshot().transport.media).toBe("degraded");
  });

  it("names the connection, not a person, when it carries nothing", async () => {
    const client = build();
    await connected(client, ["u-b"]);

    for (let round = 0; round < 3; round += 1) await sampleStats(client);

    expect(client.getSnapshot().error).toMatchObject({
      kind: "transport",
      message: expect.stringContaining("media server"),
    });
    expect(client.getSnapshot().transport.media).toBe("degraded");
  });
});

describe("recovery", () => {
  it("replaces a session the media plane closed, keeping the captures and the people", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    announce("u-b");

    realtime.emit("MediaSessionClosed", {
      channelId: CHANNEL,
      sessionId: "media-session-1",
      reason: "media-restarted",
    });

    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    const next = latestConnection();
    expect(pc.close).toHaveBeenCalled();
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(next.addTransceiver).toHaveBeenCalledWith(micTrack, expect.objectContaining({ direction: "sendonly" }));
    await vi.waitFor(() =>
      expect(realtime.mediaOfKind("offer").at(-1)?.sessionId).toBe("media-session-2"),
    );
    expect(peerOf(client, "u-b")).toBeDefined();

    // The session just replaced is stale: what it says, and its own closure, change nothing.
    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 5, tracks: [] }, "media-session-1");
    realtime.emit("MediaSessionClosed", {
      channelId: CHANNEL,
      sessionId: "media-session-1",
      reason: "transport-timeout",
    });
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 3));
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(2);
    expect(next.close).not.toHaveBeenCalled();
    expect(next.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("replaces a connection that failed, and one that stays disconnected past the grace", async () => {
    const client = build();
    const pc = await joined(client);

    pc.setState("failed");
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));

    const second = latestConnection();
    second.setState("disconnected");
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS / 2));
    expect(FakePeerConnection.instances).toHaveLength(2);

    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(3), { timeout: 1000 });
    expect(second.close).toHaveBeenCalled();
  });

  it("keeps a connection that recovers within the grace", async () => {
    const client = build();
    const pc = await joined(client);

    pc.setState("disconnected");
    pc.setState("connected");
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3));

    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it("gives up after three replacements in a row, each after a longer pause", async () => {
    const pauses: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number) => {
      if (ms !== undefined && ms > 0 && ms % PAUSE_MS === 0 && ms <= PAUSE_MS * 4) pauses.push(ms);
      return realSetTimeout(run, ms);
    }) as typeof setTimeout);
    const client = build();
    await joined(client);
    realtime.openMediaSession.mockRejectedValue(new Error("Media server is unavailable."));

    realtime.emit("MediaSessionClosed", { channelId: CHANNEL, sessionId: "media-session-1", reason: "error" });

    await vi.waitFor(() => expect(client.getSnapshot().transport.media).toBe("failed"), {
      timeout: 1000,
    });
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(4);
    expect(pauses).toEqual([PAUSE_MS, PAUSE_MS * 2, PAUSE_MS * 4]);
    expect(client.getSnapshot().error).toMatchObject({
      kind: "transport",
      message: expect.stringContaining("media server"),
    });
    expect(micTrack.stop).not.toHaveBeenCalled();
  });

  it("starts the count again once a replacement proves media", async () => {
    const client = build();
    await joined(client);

    realtime.emit("MediaSessionClosed", { channelId: CHANNEL, sessionId: "media-session-1", reason: "error" });
    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalledTimes(2));
    const second = latestConnection();
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    await answerOffer(second);
    second.setState("connected");
    second.stats = [outbound(10)];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("ready");

    realtime.openMediaSession.mockRejectedValue(new Error("Media server is unavailable."));
    realtime.emit("MediaSessionClosed", { channelId: CHANNEL, sessionId: "media-session-2", reason: "error" });

    await vi.waitFor(() => expect(client.getSnapshot().transport.media).toBe("failed"), {
      timeout: 1000,
    });
    // Without the reset, the replacement before would have used one of three.
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(5);
  });

  it("never rebuilds a working connection when the tab comes back", async () => {
    const client = build();
    const pc = await joined(client);
    pc.setState("connected");

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 3));

    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it("replaces a connection found down when the tab comes back", async () => {
    const client = build();
    const pc = await joined(client);
    // It went down while the tab slept, without a word.
    pc.connectionState = "disconnected";

    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalledTimes(2));
    expect(pc.close).toHaveBeenCalled();
  });

  it("gives fresh TURN credentials to the connection and to its replacement", async () => {
    const client = build();
    const pc = await joined(client);
    const fresh = [{ urls: ["turn:orbit.example:3478"], username: "4102448400:abc", credential: "x" }];
    ice.next = fresh;

    await (client as unknown as { refreshIceConfiguration(session: number): Promise<void> }).refreshIceConfiguration(1);
    expect(pc.setConfiguration).toHaveBeenCalledWith(expect.objectContaining({ iceServers: fresh }));

    realtime.emit("MediaSessionClosed", { channelId: CHANNEL, sessionId: "media-session-1", reason: "error" });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    expect(latestConnection().config.iceServers).toBe(fresh);
  });
});

describe("following the hub", () => {
  it("rejoins after a hub reconnect, then opens a new session on a new connection", async () => {
    const client = build();
    const pc = await joined(client);
    pc.setState("connected");
    realtime.calls = [];

    realtime.setStatus("reconnecting");
    expect(client.getSnapshot().connection).toBe("reconnecting");
    realtime.setStatus("connected");

    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    expect(realtime.calls).toEqual([`JoinVoice ${CHANNEL}`, `OpenMediaSession ${CHANNEL}`]);
    expect(pc.close).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(realtime.mediaOfKind("offer").at(-1)?.sessionId).toBe("media-session-2"),
    );
    expect(client.getSnapshot().connection).toBe("connected");
  });

  it("spends nothing of the budget while the hub is away", async () => {
    const client = build();
    const pc = await joined(client);

    realtime.setStatus("reconnecting");
    pc.setState("failed");
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 3));
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);

    realtime.setStatus("connected");

    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalledTimes(2));
    expect(client.getSnapshot().transport.media).not.toBe("failed");
  });

  it("follows an administrator move with a session in the new room", async () => {
    const client = build();
    const pc = await joined(client);
    announce("u-b");
    realtime.calls = [];

    realtime.emit("VoiceChannelMoved", { fromChannelId: CHANNEL, toChannelId: TARGET_CHANNEL });

    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    expect(realtime.calls).toEqual([
      `JoinVoice ${TARGET_CHANNEL}`,
      `OpenMediaSession ${TARGET_CHANNEL}`,
    ]);
    expect(pc.close).toHaveBeenCalled();
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(peerOf(client, "u-b")).toBeUndefined();
    await vi.waitFor(() =>
      expect(realtime.mediaOfKind("offer").at(-1)).toMatchObject({
        channelId: TARGET_CHANNEL,
        sessionId: "media-session-2",
      }),
    );

    // The old room's session is gone; nothing it says reaches the new one.
    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 9, tracks: [] }, "media-session-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(latestConnection().setRemoteDescription).not.toHaveBeenCalled();
  });

  it("stops listening to the media server once the call is left", async () => {
    const client = build();
    await joined(client);
    await client.leave();

    fromServer("offer", { type: "offer", sdp: SERVER_SDP, negotiationId: 1, tracks: [] }, "media-session-1");
    realtime.emit("MediaSessionClosed", { channelId: CHANNEL, sessionId: "media-session-1", reason: "error" });
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 3));

    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
    expect(FakePeerConnection.instances).toHaveLength(1);
  });
});
