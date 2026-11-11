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
import { IceConfigError, type VoiceIceProvider } from "./iceSession";
import { ParticipantPreferencesStore } from "./participantPreferences";
import { RemoteVoiceMixer } from "./remoteMixer";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { SpeechDetector } from "./vad";
import { WebRtcVoiceClient, type WebRtcVoiceClientOptions } from "./webrtc";

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
/** What `enumerateDevices` reports now. */
let devices: MediaDeviceInfo[];
/** The client's `devicechange` listener, once it watches the devices. */
let deviceChange: EventListener | null;

function build(options: Partial<WebRtcVoiceClientOptions> = {}): WebRtcVoiceClient {
  const client = new WebRtcVoiceClient({
    realtime,
    selfUserId: "u-a",
    selfDisplayName: "Ja",
    ice,
    translate: english,
    rtc: { protocolVersion: RTC_PROTOCOL_VERSION },
    getSettings: () => settings,
    statsIntervalMs: 60_000,
    recoveryGraceMs: GRACE_MS,
    mediaReplacementPauseMs: PAUSE_MS,
    // Every microphone is judged at once, unless a test is about the grace.
    mediaArrivalGraceMs: 0,
    ...options,
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

/** Join and have the first offer answered, so the connection is free to offer again. */
async function answered(client: WebRtcVoiceClient): Promise<FakePeerConnection> {
  const pc = await joined(client);
  await answerOffer(pc);
  return pc;
}

/** Seat `u-b` and have the media server forward their microphone. */
async function hearB(pc: FakePeerConnection, voice = fakeTrack()): Promise<MediaStreamTrack> {
  announce("u-b");
  await serverOffer(pc, 1, [{ mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice }]);
  return voice;
}

/** The audio elements that play `track`: a raw sink holds the stream the directory made for it. */
function sinksPlaying(track: MediaStreamTrack): HTMLAudioElement[] {
  return [...document.querySelectorAll<HTMLAudioElement>("[data-stellarr-voice-audio] audio")].filter(
    (element) => (element.srcObject as FakeMediaStream | null)?.getTracks().includes(track),
  );
}

function mediaDevice(kind: MediaDeviceKind, deviceId: string): MediaDeviceInfo {
  return { kind, deviceId, groupId: "group", label: deviceId, toJSON: () => ({}) };
}

/** Wait until the client watches the devices and has taken its first look at them. */
async function watchingDevices(): Promise<void> {
  await vi.waitFor(() => expect(deviceChange).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function changeDevices(next: MediaDeviceInfo[]): void {
  devices = next;
  deviceChange?.(new Event("devicechange"));
}

function statesSent(): VoiceSignal[] {
  return realtime.sent.filter((signal) => signal.kind === "state");
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

/**
 * Move the clock on by a steady round of statistics. A microphone is judged
 * again only that far apart, so rounds taken back to back would not see it move.
 */
function nextRound(): void {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 3_000);
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
  devices = [];
  deviceChange = null;
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      getDisplayMedia,
      enumerateDevices: vi.fn(async () => devices),
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "devicechange") deviceChange = listener;
      }),
      removeEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "devicechange" && deviceChange === listener) deviceChange = null;
      }),
    },
  });
});

afterEach(() => {
  for (const client of clients) client.dispose();
  vi.useRealTimers();
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
      streams: [expect.any(FakeMediaStream)],
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
    expect(ice.endSession).toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({ connection: "idle", channelId: null, peers: [] });
    expect(document.querySelector("[data-stellarr-voice-audio]")).toBeNull();
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
  it("publishes the camera on a section of its own, in the microphone's stream, and offers it", async () => {
    const client = build();
    const pc = await joined(client);
    await answerOffer(pc);
    const face = fakeTrack("video");
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([face], "cam-a"));
    // One stream for the voice and the face is what lets the others' browsers
    // play the two in sync.
    const voice = pc.addTransceiver.mock.calls[0]![1].streams![0]!;

    await client.startCamera();

    expect(pc.addTransceiver).toHaveBeenLastCalledWith(face, {
      direction: "sendonly",
      streams: [voice],
    });
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    const sdp = payloadOf(realtime.mediaOfKind("offer")[1]).sdp;
    expect(sdp.match(new RegExp(`a=msid:${voice.id} `, "g"))).toHaveLength(2);
    expect(realtime.sent).toContainEqual(
      expect.objectContaining({
        kind: "state",
        payload: expect.stringContaining(`"cameraStreamId":"${voice.id}"`),
      }),
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

    nextRound();
    pc.stats = [outbound(20), inbound("b1", 10), inbound("c1", 8)];
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({ media: "degraded", connectedPeerCount: 1 });

    nextRound();
    pc.stats = [outbound(30), inbound("b1", 15), inbound("c1", 16)];
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({ media: "connected", connectedPeerCount: 2 });
  });

  it("is connecting, not degraded, while the others' microphones are on their way", async () => {
    const client = build({ mediaArrivalGraceMs: 60_000 });
    const pc = await connected(client, ["u-b", "u-c"], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10)];

    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({ media: "connecting", connectedPeerCount: 0 });

    // Somebody is heard; the one still on the way does not make it degraded.
    nextRound();
    pc.stats = [outbound(20), inbound("b1", 10)];
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({
      media: "connected",
      peerCount: 2,
      connectedPeerCount: 1,
    });
  });

  it("stays connected when somebody joins a call that already works", async () => {
    const client = build({ mediaArrivalGraceMs: 60_000 });
    const pc = await connected(client);
    pc.stats = [outbound(10)];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("ready");

    announce("u-b");

    expect(client.getSnapshot().transport).toMatchObject({
      media: "connected",
      peerCount: 1,
      connectedPeerCount: 0,
    });
  });

  it("does not call a microphone silent on a round too close to the last to see it move", async () => {
    const client = build();
    const pc = await connected(client, ["u-b"], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 10)];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connected");

    // A probe round right after a steady one: the count has not moved yet.
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connected");

    // A whole round later the same count does say the microphone stopped.
    nextRound();
    await sampleStats(client);
    expect(client.getSnapshot().transport).toMatchObject({ media: "degraded", connectedPeerCount: 0 });
  });

  it("calls a microphone missing once its grace is over", async () => {
    const client = build({ mediaArrivalGraceMs: 30 });
    const pc = await connected(client, ["u-b", "u-c"], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 10)];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connected");

    await new Promise((resolve) => setTimeout(resolve, 40));
    pc.stats = [outbound(20), inbound("b1", 20)];
    await sampleStats(client);

    expect(client.getSnapshot().transport).toMatchObject({ media: "degraded", connectedPeerCount: 1 });
  });

  it("gives a newcomer their grace while everybody else stays connected", async () => {
    const client = build({ mediaArrivalGraceMs: 60_000 });
    const pc = await connected(client, ["u-b"], [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 10)];
    await sampleStats(client);

    announce("u-b", "u-c");

    expect(client.getSnapshot().transport).toMatchObject({
      media: "connected",
      peerCount: 2,
      connectedPeerCount: 1,
    });
  });

  it("proves a connection as soon as it comes up, without waiting for the steady round", async () => {
    const client = build();
    const pc = await joined(client);
    announce("u-b");
    await answerOffer(pc);
    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: fakeTrack() },
    ]);
    pc.stats = [outbound(10), inbound("b1", 10)];

    pc.setState("connected");

    // The steady round is a minute away in this harness.
    await vi.waitFor(() => expect(client.getSnapshot().transport.media).toBe("connected"), {
      timeout: 2_000,
    });
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

describe("reconnecting from the notice", () => {
  it("opens a fresh session after the media server was given up, without leaving the seat", async () => {
    const client = build();
    const pc = await joined(client);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      realtime.openMediaSession.mockRejectedValueOnce(new Error("Media server is unavailable."));
    }
    pc.setState("failed");
    await vi.waitFor(() => expect(client.getSnapshot().transport.media).toBe("failed"));
    realtime.calls = [];

    await client.reconnect();

    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    expect(realtime.calls).toEqual([`JoinVoice ${CHANNEL}`, `OpenMediaSession ${CHANNEL}`]);
    expect(ice.beginSession).toHaveBeenCalledTimes(2);
    expect(latestConnection()).not.toBe(pc);
    expect(client.getSnapshot()).toMatchObject({ connection: "connected", error: null });
    expect(client.getSnapshot().transport.media).toBe("connecting");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("keeps the call and says so when the hub refuses the seat", async () => {
    const client = build();
    await joined(client);
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub away"));

    await client.reconnect();

    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      error: { kind: "signaling", recoverable: true },
    });
  });

  it("joins again when the call never got its seat", async () => {
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub down"));
    const client = build();
    await client.join(CHANNEL);
    expect(client.getSnapshot().connection).toBe("failed");

    await client.reconnect();

    expect(realtime.joinVoice).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot()).toMatchObject({ connection: "connected", error: null });
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

  it("stops listening to the hub once the call is left", async () => {
    const client = build();
    await joined(client);
    await client.leave();

    announce("u-b");
    state("u-b", { muted: true });

    expect(client.getSnapshot().peers).toEqual([]);
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("tells everyone its state again after a hub reconnect", async () => {
    const client = build();
    await joined(client);
    realtime.sent = [];

    realtime.setStatus("reconnecting");
    realtime.setStatus("connected");

    await vi.waitFor(() => expect(statesSent()).toHaveLength(1));
    expect(statesSent()[0]?.toUserId).toBeUndefined();
  });

  it("reports a failed rejoin as recoverable rather than ending the call", async () => {
    const client = build();
    await joined(client);
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub gone"));

    realtime.setStatus("reconnecting");
    realtime.setStatus("connected");

    await vi.waitFor(() => expect(client.getSnapshot().error).toMatchObject({ recoverable: true }));
    expect(client.getSnapshot().channelId).toBe(CHANNEL);
  });

  it("ends the call when a move cannot be followed", async () => {
    const client = build();
    await joined(client);
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub"));

    realtime.emit("VoiceChannelMoved", { fromChannelId: CHANNEL, toChannelId: TARGET_CHANNEL });

    await vi.waitFor(() => expect(client.getSnapshot().error?.kind).toBe("signaling"));
    expect(client.getSnapshot().channelId).toBeNull();
    expect(micTrack.stop).toHaveBeenCalled();
  });

  it("ignores what the hub says about another room", async () => {
    const client = build();
    await joined(client);

    realtime.emit("VoiceChannelKicked", { channelId: "ch-other" });
    realtime.emit("VoiceChannelMoved", { fromChannelId: "ch-other", toChannelId: "ch-third" });
    realtime.emit("VoiceSessionReplaced", { channelId: "ch-other" });

    expect(client.getSnapshot()).toMatchObject({ connection: "connected", channelId: CHANNEL });
    expect(realtime.joinVoice).toHaveBeenCalledTimes(1);
  });

  it("leaves when a newer tab takes the seat, and says why", async () => {
    const client = build();
    const pc = await joined(client);

    realtime.emit("VoiceSessionReplaced", { channelId: CHANNEL });

    await vi.waitFor(() => expect(client.getSnapshot().error?.kind).toBe("session-replaced"));
    expect(client.getSnapshot().channelId).toBeNull();
    expect(realtime.leaveVoice).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });

  it("releases everything when a moderator kicks this seat", async () => {
    const client = build();
    const pc = await joined(client);

    realtime.emit("VoiceChannelKicked", { channelId: CHANNEL });

    await vi.waitFor(() => expect(client.getSnapshot().error?.kind).toBe("channel-kicked"));
    expect(client.getSnapshot().channelId).toBeNull();
    expect(realtime.leaveVoice).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });

  it("releases everything when the other person declines a direct call", async () => {
    const client = build();
    const pc = await joined(client);

    realtime.emit("DirectCallDeclined", { channelId: CHANNEL, byUserId: "u-b" });

    await vi.waitFor(() => expect(client.getSnapshot().channelId).toBeNull());
    expect(realtime.leaveVoice).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });
});

describe("the tab", () => {
  it("does not leave the call on an ordinary tab switch", async () => {
    const client = build();
    await joined(client);

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getSnapshot().connection).toBe("connected");
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
  });

  it("stops watching the tab once the call is left", async () => {
    const client = build();
    await joined(client);
    const fromDocument = vi.spyOn(document, "removeEventListener");
    const fromWindow = vi.spyOn(window, "removeEventListener");

    await client.leave();

    expect(fromDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(fromWindow).toHaveBeenCalledWith("pageshow", expect.any(Function));
    expect(fromWindow).toHaveBeenCalledWith("online", expect.any(Function));
  });

  it("never replaces a connection that was disconnected when the call was left", async () => {
    const client = build();
    const pc = await joined(client);
    pc.setState("disconnected");

    await client.leave();
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS + PAUSE_MS * 3));

    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
    expect(FakePeerConnection.instances).toHaveLength(1);
  });
});

describe("joining and leaving", () => {
  it("refreshes ICE before joining the hub, then announces its state", async () => {
    const order: string[] = [];
    ice.beginSession.mockImplementation(async () => {
      order.push("ice");
      return ICE;
    });
    realtime.joinVoice.mockImplementation(async () => {
      order.push("hub");
    });
    const client = build();

    await client.join(CHANNEL);

    // A connection built on a stale credential would never relay, so the
    // refresh has to win this race every time.
    expect(order).toEqual(["ice", "hub"]);
    expect(client.getSnapshot()).toMatchObject({ connection: "connected", channelId: CHANNEL, error: null });
    expect(client.getSnapshot().peers).toHaveLength(1);
    expect(JSON.parse(statesSent()[0]!.payload)).toEqual({
      muted: false,
      screenStreamId: null,
      cameraStreamId: null,
    });
  });

  it("does nothing when asked to join the channel it is already in", async () => {
    const client = build();
    await client.join(CHANNEL);

    await client.join(CHANNEL);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(realtime.joinVoice).toHaveBeenCalledTimes(1);
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
  });

  it("refuses another RTC version before opening the microphone", async () => {
    const client = build({ rtc: { protocolVersion: 2 } });

    await client.join(CHANNEL);

    expect(client.getSnapshot()).toMatchObject({
      connection: "failed",
      transport: { signaling: "disconnected", media: "failed" },
      error: { kind: "unsupported" },
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(realtime.joinVoice).not.toHaveBeenCalled();
    expect(realtime.openMediaSession).not.toHaveBeenCalled();
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("reports a blocked microphone and never reaches the hub", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const client = build();

    await client.join(CHANNEL);

    expect(client.getSnapshot()).toMatchObject({
      connection: "failed",
      channelId: CHANNEL,
      error: { kind: "mic-denied" },
    });
    expect(ice.beginSession).not.toHaveBeenCalled();
    expect(realtime.joinVoice).not.toHaveBeenCalled();
    expect(realtime.openMediaSession).not.toHaveBeenCalled();
  });

  it("does not retry a blocked microphone on another device", async () => {
    settings = { ...settings, inputDeviceId: "usb-mic" };
    getUserMedia.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    const client = build();

    await client.join(CHANNEL);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().error?.kind).toBe("mic-denied");
  });

  it("joins on the system microphone when a persisted device is gone", async () => {
    settings = { ...settings, inputDeviceId: "missing-usb-mic" };
    const updateSettings = vi.fn();
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
      .mockResolvedValueOnce(new FakeMediaStream([fakeTrack()], "mic-system"));
    const client = build({ updateSettings });

    await client.join(CHANNEL);

    expect(updateSettings).toHaveBeenCalledWith({ inputDeviceId: null });
    expect(getUserMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        audio: expect.objectContaining({ deviceId: { exact: "missing-usb-mic" } }),
      }),
    );
    expect(getUserMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ audio: expect.not.objectContaining({ deviceId: expect.anything() }) }),
    );
    expect(client.getSnapshot().connection).toBe("connected");
  });

  it("releases the microphone and the ICE session when the hub join fails", async () => {
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub down"));
    const client = build();

    await client.join(CHANNEL);

    expect(client.getSnapshot()).toMatchObject({ connection: "failed", error: { kind: "signaling" } });
    expect(micTrack.stop).toHaveBeenCalled();
    expect(ice.endSession).toHaveBeenCalled();
    expect(realtime.openMediaSession).not.toHaveBeenCalled();
  });

  it("still leaves when the hub is unreachable", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.leaveVoice.mockRejectedValueOnce(new Error("hub gone"));

    await client.leave();

    expect(client.getSnapshot().channelId).toBeNull();
  });

  it("drops a join that is left while the microphone is still opening", async () => {
    const opening = deferred<FakeMediaStream>();
    getUserMedia.mockReturnValueOnce(opening.promise);
    const client = build();

    const joining = client.join(CHANNEL);
    await client.leave();
    opening.resolve(new FakeMediaStream([micTrack], "mic-a"));
    await joining;

    expect(micTrack.stop).toHaveBeenCalled();
    expect(realtime.joinVoice).not.toHaveBeenCalled();
    expect(client.getSnapshot().channelId).toBeNull();
  });

  it("does not report a state frame that misses someone who already left", async () => {
    realtime.sendVoiceSignal.mockImplementation(async (signal: VoiceSignal) => {
      if (signal.toUserId !== undefined) throw new Error("already left");
    });
    const client = build();
    await joined(client);

    announce("u-b");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getSnapshot()).toMatchObject({ connection: "connected", error: null });
  });

  it("survives a state frame it cannot read, and one from someone who is not here", async () => {
    const client = build();
    await joined(client);
    announce("u-b");

    realtime.emit("VoiceSignal", {
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: CHANNEL,
      fromUserId: "u-b",
      kind: "state",
      payload: "not json",
    });
    state("u-nobody", { muted: true });

    expect(client.getSnapshot()).toMatchObject({ connection: "connected", error: null });
    expect(peerOf(client, "u-b")?.muted).toBe(false);
    expect(peerOf(client, "u-nobody")).toBeUndefined();
  });
});

describe("the ICE configuration", () => {
  it("does not touch the network until someone actually joins", async () => {
    const client = build();
    expect(ice.beginSession).not.toHaveBeenCalled();

    await joined(client);

    expect(ice.beginSession).toHaveBeenCalledTimes(1);
  });

  it("passes the per-user TURN credential through untouched", async () => {
    const client = build();
    const pc = await joined(client);

    const turn = (pc.config.iceServers ?? []).find((server) => String(server.urls).includes("turn:"));
    expect(turn).toMatchObject({ username: "4102444800:abc", credential: "secret==" });
  });

  it("refreshes once for a room of three, on its one connection", async () => {
    const client = build();
    await joined(client);

    announce("u-b", "u-c", "u-d");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ice.beginSession).toHaveBeenCalledTimes(1);
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("refreshes again after leaving and rejoining", async () => {
    const client = build();
    await client.join(CHANNEL);
    await client.leave();
    expect(ice.endSession).toHaveBeenCalled();

    await client.join(CHANNEL);

    expect(ice.beginSession).toHaveBeenCalledTimes(2);
  });

  it("rotates the servers of a healthy connection without replacing it", async () => {
    const client = build();
    const pc = await joined(client);
    pc.setState("connected");
    const refreshed: RTCIceServer[] = [
      { urls: ["stun:new.example:3478"] },
      { urls: ["turns:new.example:5349?transport=tcp"], username: "4102448400:abc", credential: "fresh==" },
    ];
    ice.next = refreshed;

    await (client as unknown as { refreshIceConfiguration(session: number): Promise<void> }).refreshIceConfiguration(1);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 3));

    expect(pc.setConfiguration).toHaveBeenCalledWith(expect.objectContaining({ iceServers: refreshed }));
    expect(pc.close).not.toHaveBeenCalled();
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
  });

  it("replaces at once a connection the refresh finds failed", async () => {
    const client = build();
    const pc = await joined(client);
    // It failed without a word, as a sleeping tab lets it.
    pc.connectionState = "failed";

    await (client as unknown as { refreshIceConfiguration(session: number): Promise<void> }).refreshIceConfiguration(1);

    await vi.waitFor(() => expect(realtime.openMediaSession).toHaveBeenCalledTimes(2));
    expect(pc.close).toHaveBeenCalled();
    expect(latestConnection().config.iceServers).toEqual(ICE);
  });

  it("surfaces expired credentials as a failed join that can be retried", async () => {
    ice.beginSession.mockRejectedValueOnce(new IceConfigError("expired", "credentials expired"));
    const client = build();

    await client.join(CHANNEL);

    const failed = client.getSnapshot();
    expect(failed).toMatchObject({ connection: "failed", error: { kind: "ice-config" } });
    expect(failed.error?.message).toContain("expired");
    // The dock needs the channel to render the error and its retry.
    expect(failed.channelId).toBe(CHANNEL);
    // An open microphone after a failed join is a privacy problem, not just untidy.
    expect(micTrack.stop).toHaveBeenCalled();
    // Nothing was built on a credential nobody trusts.
    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(realtime.joinVoice).not.toHaveBeenCalled();

    await client.join(CHANNEL);

    expect(client.getSnapshot().connection).toBe("connected");
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("tells an unreachable server apart from expired credentials", async () => {
    ice.beginSession.mockRejectedValueOnce(new IceConfigError("unavailable", "no config"));
    const client = build();

    await client.join(CHANNEL);

    expect(client.getSnapshot().error?.message).toContain("Could not load");
    expect(micTrack.stop).toHaveBeenCalled();
  });

  it("measures the signalling round trip while the room is empty", async () => {
    const client = build();
    await joined(client);
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(142);

    await sampleStats(client);

    expect(realtime.getRtcClock).toHaveBeenCalled();
    expect(client.getSnapshot().diagnostics).toMatchObject({
      quality: "good",
      lossFraction: null,
      rttMs: 42,
    });
    clock.mockRestore();
  });

  it("requires fresh RTP proof after the connection comes back", async () => {
    const client = build();
    const pc = await answered(client);
    pc.setState("connected");
    pc.stats = [outbound(10)];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("ready");

    // Back within the grace, so the connection is kept, but the old counters
    // prove nothing.
    pc.setState("disconnected");
    pc.setState("connected");
    expect(client.getSnapshot().transport.media).toBe("connecting");
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("connecting");

    pc.stats = [outbound(20)];
    await sampleStats(client);
    expect(client.getSnapshot().transport.media).toBe("ready");
  });
});

describe("mute and deafen", () => {
  it("mutes only the outgoing track and tells everyone", async () => {
    const client = build();
    await joined(client);
    realtime.sent = [];

    client.setMuted(true);

    expect(micTrack.enabled).toBe(false);
    expect(client.getSnapshot()).toMatchObject({ muted: true });
    await vi.waitFor(() => expect(statesSent()).toHaveLength(1));
    expect(JSON.parse(statesSent()[0]!.payload).muted).toBe(true);

    client.setMuted(false);
    expect(micTrack.enabled).toBe(true);
  });

  it("opens the microphone muted when the person muted before joining", async () => {
    const client = build();
    client.setMuted(true);

    await joined(client);

    expect(micTrack.enabled).toBe(false);
    client.setMuted(false);
    expect(micTrack.enabled).toBe(true);
  });

  it("mutes only the microphone, never the sound it shares", async () => {
    const shared = fakeTrack("audio", 2);
    getDisplayMedia.mockResolvedValueOnce(new FakeMediaStream([fakeTrack("video"), shared], "screen-a"));
    const client = build();
    await answered(client);
    await client.startScreenShare();

    client.setMuted(true);

    expect(micTrack.enabled).toBe(false);
    // Shared system sound is content, not the person's voice.
    expect(shared.enabled).toBe(true);
  });

  it("learns another person's mute state from their frame", async () => {
    const client = build();
    await joined(client);
    announce("u-b");

    state("u-b", { muted: true });

    expect(peerOf(client, "u-b")?.muted).toBe(true);
  });

  it("deafens remote voices at once and restores them", async () => {
    const client = build();
    const pc = await answered(client);
    const [audible] = sinksPlaying(await hearB(pc));

    client.setDeafened(true);
    expect(audible?.muted).toBe(true);

    client.setDeafened(false);
    expect(audible?.muted).toBe(false);
  });

  it("deafening still mutes the audible sink of a processed voice", async () => {
    vi.spyOn(RemoteVoiceMixer.prototype, "attach").mockReturnValue(true);
    vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockResolvedValue(true);
    const client = build();
    const pc = await answered(client);
    await hearB(pc);
    const audible = document.querySelector<HTMLAudioElement>("[data-stellarr-voice-audio] audio");

    client.setDeafened(true);

    expect(audible?.muted).toBe(true);
  });
});

describe("remote voice", () => {
  it("keeps the raw stream off the speakers while the mixer plays a voice", async () => {
    const attach = vi.spyOn(RemoteVoiceMixer.prototype, "attach").mockReturnValue(true);
    vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockResolvedValue(true);
    const client = build();
    const pc = await answered(client);

    const voice = await hearB(pc);

    const [audible, decoder] = document.querySelectorAll<HTMLAudioElement>("[data-stellarr-voice-audio] audio");
    expect(attach).toHaveBeenCalledWith("u-b", decoder?.srcObject, audible, 100, {
      gated: false,
      suppressed: false,
    });
    // The muted decoder keeps the jitter buffer running; only the mixer is heard.
    expect(sinksPlaying(voice)).toEqual([decoder]);
  });

  it("plays the raw stream when Web Audio is unavailable, at the person's volume", async () => {
    const client = build();
    const pc = await answered(client);
    const voice = await hearB(pc);

    const [audible] = sinksPlaying(voice);
    expect(audible?.muted).toBe(false);
    client.setPeerVolume("u-b", 50);

    expect(audible?.volume).toBeCloseTo(0.5);
  });

  it("clamps an absurd volume", async () => {
    const client = build();
    await joined(client);
    announce("u-b");

    client.setPeerVolume("u-b", 900);

    expect(peerOf(client, "u-b")?.playbackVolume).toBe(200);
  });

  it("starts a returning person the way they sounded last time, and remembers changes", async () => {
    const preferences = new ParticipantPreferencesStore(null, "u-a");
    preferences.set("u-b", { volume: 40, gated: true, suppressed: true });
    const client = build({ participantPreferences: preferences });
    await joined(client);

    announce("u-b");

    expect(peerOf(client, "u-b")).toMatchObject({ playbackVolume: 40, gated: true, suppressed: true });
    client.setPeerVolume("u-b", 70);
    client.setPeerGate("u-b", false);
    expect(preferences.get("u-b")).toEqual({ volume: 70, gated: false, suppressed: true });
    // This side's own strip has nothing to gate or denoise.
    expect(client.getSnapshot().peers.find((peer) => peer.self)).toMatchObject({
      gated: false,
      suppressed: false,
    });
  });

  it("stops playing a microphone whose track ended instead of keeping a dead sink", async () => {
    const client = build();
    const pc = await answered(client);
    const voice = await hearB(pc);
    expect(sinksPlaying(voice)).toHaveLength(1);

    (voice.onended as unknown as () => void)();

    expect(sinksPlaying(voice)).toHaveLength(0);
  });

  it("retries playback after a background spell", async () => {
    const client = build();
    const pc = await answered(client);
    const [audible] = sinksPlaying(await hearB(pc));
    const play = vi.spyOn(audible!, "play").mockResolvedValue(undefined);

    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => expect(play).toHaveBeenCalled());
  });

  it("retries playback on the next user gesture", async () => {
    const client = build();
    const pc = await answered(client);
    const voice = await hearB(pc);
    const [audible] = sinksPlaying(voice);
    const play = vi.spyOn(audible!, "play").mockResolvedValue(undefined);

    document.dispatchEvent(new Event("pointerdown"));

    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    expect(sinksPlaying(voice)).toEqual([audible]);
  });
});

describe("remote shares and cameras", () => {
  async function seatedB(client: WebRtcVoiceClient): Promise<FakePeerConnection> {
    const pc = await answered(client);
    announce("u-b");
    return pc;
  }

  it("shows a share and a camera only once the person announced them", async () => {
    const client = build();
    const pc = await seatedB(client);
    await serverOffer(pc, 1, [
      { mid: "s1", userId: "u-b", kind: "video", streamId: "scr-b", track: fakeTrack("video") },
      { mid: "c1", userId: "u-b", kind: "video", streamId: "cam-b", track: fakeTrack("video") },
    ]);
    expect(peerOf(client, "u-b")).toMatchObject({ screen: null, camera: null });

    state("u-b", { screenStreamId: "scr-b", cameraStreamId: "cam-b" });

    expect(peerOf(client, "u-b")?.screen?.streamId).toBe("scr-b");
    expect(peerOf(client, "u-b")?.camera?.streamId).toBe("cam-b");
    // Pictures are for the UI to render; the client itself never makes one.
    expect(document.querySelector("video")).toBeNull();
  });

  it("moves a share's sound off the voice once the state frame names it", async () => {
    const client = build();
    const pc = await seatedB(client);
    const voice = fakeTrack();
    const sound = fakeTrack("audio", 2);
    // Neither sound has a picture yet, so both pass for microphones.
    await serverOffer(pc, 1, [
      { mid: "s2", userId: "u-b", kind: "audio", streamId: "scr-b", track: sound },
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice },
    ]);

    state("u-b", { screenStreamId: "scr-b" });

    expect(sinksPlaying(voice)).toHaveLength(1);
    expect(sinksPlaying(sound)).toHaveLength(1);
    expect(sinksPlaying(voice)[0]).not.toBe(sinksPlaying(sound)[0]);
  });

  it("plays somebody's shared sound at the volume chosen for them", async () => {
    const client = build();
    const pc = await seatedB(client);
    const sound = fakeTrack("audio", 2);
    state("u-b", { screenStreamId: "scr-b" });
    await serverOffer(pc, 1, [
      { mid: "s1", userId: "u-b", kind: "video", streamId: "scr-b", track: fakeTrack("video") },
      { mid: "s2", userId: "u-b", kind: "audio", streamId: "scr-b", track: sound },
    ]);

    client.setPeerVolume("u-b", 40);

    expect(sinksPlaying(sound)[0]?.volume).toBeCloseTo(0.4);
  });

  it("keeps the share's picture when only its sound ends", async () => {
    const client = build();
    const pc = await seatedB(client);
    const sound = fakeTrack("audio", 2);
    state("u-b", { screenStreamId: "scr-b" });
    await serverOffer(pc, 1, [
      { mid: "s1", userId: "u-b", kind: "video", streamId: "scr-b", track: fakeTrack("video") },
      { mid: "s2", userId: "u-b", kind: "audio", streamId: "scr-b", track: sound },
    ]);
    expect(peerOf(client, "u-b")?.screen?.hasAudio).toBe(true);

    (sound.onended as unknown as () => void)();

    expect(peerOf(client, "u-b")?.screen).toMatchObject({ streamId: "scr-b", hasAudio: false });
    expect(sinksPlaying(sound)).toHaveLength(0);
  });

  it("clears the share when its picture ends, and keeps the voice playing", async () => {
    const client = build();
    const pc = await seatedB(client);
    const voice = fakeTrack();
    const picture = fakeTrack("video");
    state("u-b", { screenStreamId: "scr-b" });
    await serverOffer(pc, 1, [
      { mid: "b1", userId: "u-b", kind: "audio", streamId: "mic-b", track: voice },
      { mid: "s1", userId: "u-b", kind: "video", streamId: "scr-b", track: picture },
      { mid: "s2", userId: "u-b", kind: "audio", streamId: "scr-b", track: fakeTrack("audio", 2) },
    ]);

    (picture.onended as unknown as () => void)();

    expect(peerOf(client, "u-b")?.screen).toBeNull();
    expect(sinksPlaying(voice)).toHaveLength(1);
  });

  it("never reuses a camera that was withdrawn for a later share", async () => {
    const client = build();
    const pc = await seatedB(client);
    state("u-b", { cameraStreamId: "cam-b" });
    await serverOffer(pc, 1, [
      { mid: "c1", userId: "u-b", kind: "video", streamId: "cam-b", track: fakeTrack("video") },
    ]);
    expect(peerOf(client, "u-b")?.camera).not.toBeNull();

    state("u-b", { cameraStreamId: null });
    state("u-b", { screenStreamId: "cam-b" });

    expect(peerOf(client, "u-b")).toMatchObject({ camera: null, screen: null });
  });
});

describe("audio tuning", () => {
  it("marks the microphone track as speech", async () => {
    const client = build();

    await joined(client);

    expect(micTrack.contentHint).toBe("speech");
  });

  it("asks for mono 48 kHz capture with the browser's echo and noise processing on", async () => {
    settings = { ...settings, noiseSuppression: "browser" };
    const client = build();

    await joined(client);

    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        // Automatic volume is the pipeline's own leveller; the platform AGC is
        // switched back on only if that graph cannot be built.
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
  });

  it("offers the microphone with the whole Opus speech profile", async () => {
    const client = build();

    await joined(client);

    const { sdp } = payloadOf(realtime.mediaOfKind("offer")[0]);
    const fmtp = fmtpOf(sdp, "0");
    for (const parameter of [
      "usedtx=0",
      "useinbandfec=1",
      "maxaveragebitrate=128000",
      "stereo=0",
      "sprop-stereo=0",
      "minptime=10",
    ]) {
      expect(fmtp).toContain(parameter);
    }
    expect(sdp).toContain("a=ptime:20");
  });

  it("puts Opus first through setCodecPreferences", async () => {
    vi.stubGlobal("RTCRtpReceiver", {
      getCapabilities: () => ({
        codecs: [
          { mimeType: "audio/PCMU", clockRate: 8000 },
          { mimeType: "audio/opus", clockRate: 48000, channels: 2 },
        ],
      }),
    });
    const client = build();

    const pc = await joined(client);

    const ordered = pc.transceivers[0]?.setCodecPreferences.mock.calls[0]?.[0] as RTCRtpCodec[];
    expect(ordered.map((codec) => codec.mimeType)).toEqual(["audio/opus", "audio/PCMU"]);
  });

  it("caps the default Premium sender at 128 kb/s", async () => {
    const client = build();

    const pc = await joined(client);

    await vi.waitFor(() =>
      expect(pc.transceivers[0]?.sender.parameters.encodings[0]?.maxBitrate).toBe(128_000),
    );
  });

  it("joins with the Studio profile in both the offer and the sender", async () => {
    settings = { ...settings, opusProfile: "studio" };
    const client = build();

    const pc = await joined(client);

    expect(fmtpOf(payloadOf(realtime.mediaOfKind("offer")[0]).sdp, "0")).toContain(
      "maxaveragebitrate=256000",
    );
    await vi.waitFor(() =>
      expect(pc.transceivers[0]?.sender.parameters.encodings[0]?.maxBitrate).toBe(256_000),
    );
  });

  it("still answers when the browser rejects the tuned description", async () => {
    const client = build();
    const pc = await answered(client);
    pc.setLocalDescription.mockRejectedValueOnce(new Error("InvalidModification"));

    await serverOffer(pc, 1, []);

    // The untouched description goes instead of failing the call.
    expect(payloadOf(realtime.mediaOfKind("answer")[0])).toMatchObject({ type: "answer", negotiationId: 1 });
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
  });
});

describe("live settings", () => {
  it("applies a profile change without reopening the microphone, and offers the new ceiling", async () => {
    const client = build();
    await answered(client);

    await client.applySettings({ ...settings, opusProfile: "clarity" });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    expect(fmtpOf(payloadOf(realtime.mediaOfKind("offer")[1]).sdp, "0")).toContain(
      "maxaveragebitrate=96000",
    );
  });

  it("keeps the running microphone and stays in the call when the new device fails", async () => {
    const client = build();
    await joined(client);
    getUserMedia.mockRejectedValueOnce(new DOMException("gone", "NotFoundError"));

    await client.applySettings({ ...settings, inputDeviceId: "unplugged" });

    expect(client.getSnapshot()).toMatchObject({ connection: "connected", error: { recoverable: true } });
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
  });

  it("keeps the running microphone when the sender refuses the new one", async () => {
    const client = build();
    const pc = await joined(client);
    const sender = pc.transceivers[0]!.sender;
    sender.replaceTrack.mockRejectedValueOnce(new Error("sender closed"));
    const replacement = fakeTrack();
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([replacement], "mic-a2"));

    await client.applySettings({ ...settings, inputDeviceId: "other-mic" });

    expect(sender.track).toBe(micTrack);
    expect(replacement.stop).toHaveBeenCalledOnce();
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(client.getSnapshot().error).toMatchObject({ kind: "mic-unavailable", recoverable: true });
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid device changes and never adopts a stale slow capture", async () => {
    const client = build();
    const pc = await joined(client);
    const slow = deferred<FakeMediaStream>();
    const latest = deferred<FakeMediaStream>();
    const staleTrack = fakeTrack();
    const latestTrack = fakeTrack();
    getUserMedia.mockReturnValueOnce(slow.promise).mockReturnValueOnce(latest.promise);

    const choosingSlow = client.applySettings({ ...settings, inputDeviceId: "mic-slow" });
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    const choosingLatest = client.applySettings({ ...settings, inputDeviceId: "mic-latest" });
    slow.resolve(new FakeMediaStream([staleTrack], "mic-slow"));
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3));
    latest.resolve(new FakeMediaStream([latestTrack], "mic-latest"));
    await Promise.all([choosingSlow, choosingLatest]);

    const sender = pc.transceivers[0]!.sender;
    expect(sender.replaceTrack.mock.calls).toEqual([[latestTrack]]);
    expect(staleTrack.stop).toHaveBeenCalledOnce();
    expect(micTrack.stop).toHaveBeenCalledOnce();
  });

  it("tells everyone its state again once the microphone moved", async () => {
    const client = build();
    await joined(client);
    realtime.sent = [];
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([fakeTrack()], "mic-a2"));

    await client.applySettings({ ...settings, inputDeviceId: "other-mic" });

    await vi.waitFor(() => expect(statesSent()).toHaveLength(1));
    const [frame] = statesSent();
    expect(frame?.toUserId).toBeUndefined();
    expect(JSON.parse(frame!.payload)).toEqual({ muted: false, screenStreamId: null, cameraStreamId: null });
  });

  it("sends no state when the microphone did not move", async () => {
    const client = build();
    await joined(client);
    realtime.sent = [];

    await client.applySettings({ ...settings, vadSensitivity: 80 });
    getUserMedia.mockRejectedValueOnce(new DOMException("gone", "NotFoundError"));
    await client.applySettings({ ...settings, vadSensitivity: 80, inputDeviceId: "unplugged" });

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(statesSent()).toEqual([]);
  });

  it("falls back to the system microphone, and remembers that, when the chosen one ends", async () => {
    settings = { ...settings, inputDeviceId: "usb-mic" };
    const updateSettings = vi.fn();
    const client = build({ updateSettings });
    const pc = await joined(client);
    const replacement = fakeTrack();
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([replacement], "mic-system"));

    (micTrack.onended as unknown as () => void)();

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ inputDeviceId: null }));
    await vi.waitFor(() => expect(micTrack.stop).toHaveBeenCalled());
    expect(pc.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(replacement);
  });

  it("reopens the system-default microphone when its physical route changes", async () => {
    const client = build();
    await joined(client);
    const replacement = fakeTrack();
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([replacement], "mic-system"));

    (micTrack.onended as unknown as () => void)();

    await vi.waitFor(() => expect(micTrack.stop).toHaveBeenCalled());
    expect(replacement.stop).not.toHaveBeenCalled();
    expect(client.getSnapshot().connection).toBe("connected");
  });

  it("follows a changed system-default microphone on devicechange", async () => {
    devices = [mediaDevice("audioinput", "mic-1")];
    const client = build();
    await joined(client);
    await watchingDevices();
    const replacement = fakeTrack();
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([replacement], "mic-system"));

    changeDevices([mediaDevice("audioinput", "mic-2")]);

    await vi.waitFor(() => expect(micTrack.stop).toHaveBeenCalled(), { timeout: 1_000 });
    expect(replacement.stop).not.toHaveBeenCalled();
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
  });

  it("forgets a chosen microphone that was unplugged", async () => {
    devices = [mediaDevice("audioinput", "usb-mic")];
    settings = { ...settings, inputDeviceId: "usb-mic" };
    const updateSettings = vi.fn();
    const client = build({ updateSettings });
    await joined(client);
    await watchingDevices();
    getUserMedia.mockResolvedValueOnce(new FakeMediaStream([fakeTrack()], "mic-system"));

    changeDevices([]);

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ inputDeviceId: null }), {
      timeout: 1_000,
    });
    await vi.waitFor(() => expect(micTrack.stop).toHaveBeenCalled());
  });

  it("remembers the system output when the chosen one is unavailable", async () => {
    settings = { ...settings, outputDeviceId: "missing-headset" };
    const updateSettings = vi.fn();
    const client = build({ updateSettings });
    await joined(client);

    announce("u-b");

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ outputDeviceId: null }));
  });

  it("moves playback to the system output when the chosen one is unplugged", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "setSinkId");
    const setSinkId = vi.fn(async () => undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", { configurable: true, value: setSinkId });
    try {
      settings = { ...settings, outputDeviceId: "usb-headphones" };
      devices = [mediaDevice("audiooutput", "usb-headphones")];
      const updateSettings = vi.fn();
      const client = build({ updateSettings });
      const pc = await answered(client);
      await hearB(pc);
      await watchingDevices();
      await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledWith("usb-headphones"));
      setSinkId.mockClear();

      changeDevices([mediaDevice("audiooutput", "built-in-speakers")]);

      await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ outputDeviceId: null }), {
        timeout: 1_000,
      });
      await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledWith(""));
      expect(realtime.leaveVoice).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", original);
      else delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
  });

  it("forgets a chosen camera that was unplugged, though no camera is on", async () => {
    devices = [mediaDevice("videoinput", "cam-1")];
    settings = { ...settings, videoDeviceId: "cam-1" };
    const updateSettings = vi.fn();
    const client = build({ updateSettings });
    await joined(client);
    await watchingDevices();

    changeDevices([]);

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null }), {
      timeout: 1_000,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(micTrack.stop).not.toHaveBeenCalled();
  });

  describe("with the camera on", () => {
    function cameraCapture(id: string) {
      const video = fakeTrack("video");
      return { video, stream: new FakeMediaStream([video], id) };
    }

    async function cameraOn(client: WebRtcVoiceClient) {
      devices = [mediaDevice("videoinput", "cam-a"), mediaDevice("videoinput", "cam-b")];
      const pc = await answered(client);
      await watchingDevices();
      const first = cameraCapture("cam-1");
      getUserMedia.mockResolvedValueOnce(first.stream);
      await client.startCamera();
      return { pc, first, sender: pc.transceivers[1]!.sender };
    }

    it("reopens a camera that follows the system default when the cameras change", async () => {
      const client = build();
      const { first, sender } = await cameraOn(client);
      const second = cameraCapture("cam-2");
      getUserMedia.mockResolvedValueOnce(second.stream);

      changeDevices([mediaDevice("videoinput", "cam-c")]);

      await vi.waitFor(() => expect(sender.replaceTrack).toHaveBeenCalledWith(second.video), {
        timeout: 1_000,
      });
      expect(first.video.stop).toHaveBeenCalled();
      expect(micTrack.stop).not.toHaveBeenCalled();
    });

    it("moves to the system camera when the chosen one is unplugged, and forgets the choice", async () => {
      settings = { ...settings, videoDeviceId: "cam-a" };
      const updateSettings = vi.fn();
      const client = build({ updateSettings });
      const { first, sender } = await cameraOn(client);
      const second = cameraCapture("cam-2");
      getUserMedia.mockResolvedValueOnce(second.stream);

      changeDevices([mediaDevice("videoinput", "cam-b")]);

      await vi.waitFor(() => expect(sender.replaceTrack).toHaveBeenCalledWith(second.video), {
        timeout: 1_000,
      });
      expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null });
      expect(first.video.stop).toHaveBeenCalled();
    });

    it("leaves a camera chosen by id alone when another camera comes or goes", async () => {
      settings = { ...settings, videoDeviceId: "cam-a" };
      const client = build();
      const { first } = await cameraOn(client);
      const opened = getUserMedia.mock.calls.length;

      changeDevices([mediaDevice("videoinput", "cam-a")]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(getUserMedia).toHaveBeenCalledTimes(opened);
      expect(first.video.stop).not.toHaveBeenCalled();
    });
  });
});

describe("screen share", () => {
  it("opens the picker with the selected capture ceiling", async () => {
    settings = { ...settings, screenShareQuality: "economy" };
    const client = build();
    await joined(client);

    await client.startScreenShare();

    expect(getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ height: { max: 720 }, frameRate: { max: 15 } }),
      }),
    );
  });

  it("publishes the picture and the sound on send-only sections of their own", async () => {
    const client = build();
    const pc = await answered(client);

    await client.startScreenShare();

    expect(pc.transceivers.slice(1).map(({ kind, direction }) => [kind, direction])).toEqual([
      ["video", "sendonly"],
      ["audio", "sendonly"],
    ]);
    expect(client.getSnapshot().localScreen?.hasAudio).toBe(true);
  });

  it("works without system sound when the picker gave none", async () => {
    getDisplayMedia.mockResolvedValueOnce(new FakeMediaStream([fakeTrack("video")], "screen-a"));
    const client = build();
    const pc = await answered(client);

    await client.startScreenShare();

    expect(pc.transceivers).toHaveLength(2);
    expect(client.getSnapshot().localScreen?.hasAudio).toBe(false);
  });

  it("announces the share's stream id in its state", async () => {
    const client = build();
    await answered(client);
    realtime.sent = [];

    await client.startScreenShare();

    expect(JSON.parse(statesSent().at(-1)?.payload ?? "{}")).toMatchObject({
      screenStreamId: "screen-a",
      cameraStreamId: null,
    });
  });

  it("tells a newcomer about the share in progress", async () => {
    const client = build();
    await answered(client);
    await client.startScreenShare();
    realtime.sent = [];

    announce("u-b");

    await vi.waitFor(() => expect(statesSent()).toHaveLength(1));
    expect(statesSent()[0]?.toUserId).toBe("u-b");
    expect(JSON.parse(statesSent()[0]!.payload).screenStreamId).toBe("screen-a");
  });

  it("keeps sharing the picture when the system sound ends", async () => {
    const picture = fakeTrack("video");
    const sound = fakeTrack("audio", 2);
    getDisplayMedia.mockResolvedValueOnce(new FakeMediaStream([picture, sound], "screen-a"));
    const client = build();
    const pc = await answered(client);
    await client.startScreenShare();
    const soundSender = pc.transceivers[2]!.sender;

    (sound.onended as unknown as () => void)();

    await vi.waitFor(() => expect(client.getSnapshot().localScreen?.hasAudio).toBe(false));
    expect(client.getSnapshot().localScreen?.stream).toBeDefined();
    expect(pc.removeTrack).toHaveBeenCalledWith(soundSender);
    expect(pc.transceivers[1]?.direction).toBe("sendonly");
    expect(picture.stop).not.toHaveBeenCalled();
  });

  it("caps the share's encoding and holds its resolution", async () => {
    const client = build();
    const pc = await answered(client);

    await client.startScreenShare();

    const sender = pc.transceivers[1]!.sender;
    await vi.waitFor(() => expect(sender.setParameters).toHaveBeenCalled());
    const applied = sender.setParameters.mock.calls[0]?.[0] as RTCRtpSendParameters & {
      degradationPreference?: string;
    };
    expect(applied.encodings[0]).toMatchObject({ maxBitrate: 2_500_000, maxFramerate: 30 });
    // Readable text beats smooth frames on a desktop.
    expect(applied.degradationPreference).toBe("maintain-resolution");
  });

  it("changes capture and compression during a share", async () => {
    const picture = fakeTrack("video");
    getDisplayMedia.mockResolvedValueOnce(new FakeMediaStream([picture], "screen-a"));
    const client = build();
    const pc = await answered(client);
    await client.startScreenShare();
    const sender = pc.transceivers[1]!.sender;

    await client.applySettings({ ...settings, screenShareQuality: "sharp" });

    expect(picture.applyConstraints).toHaveBeenCalledWith({ height: { max: 1440 }, frameRate: { max: 30 } });
    const applied = sender.setParameters.mock.calls.at(-1)?.[0] as RTCRtpSendParameters;
    expect(applied.encodings[0]).toMatchObject({
      maxBitrate: 5_000_000,
      maxFramerate: 30,
      scalabilityMode: "L1T2",
      priority: "medium",
      networkPriority: "medium",
    });
  });

  it("falls back without temporal layers on an older WebRTC stack", async () => {
    const client = build();
    const pc = await answered(client);
    await client.startScreenShare();
    const sender = pc.transceivers[1]!.sender;
    sender.setParameters.mockRejectedValueOnce(new Error("unsupported"));

    await client.applySettings({ ...settings, screenShareQuality: "ultra" });

    const fallback = sender.setParameters.mock.calls.at(-1)?.[0] as RTCRtpSendParameters;
    expect(fallback.encodings[0]).toMatchObject({ maxBitrate: 12_000_000, maxFramerate: 60 });
    expect(fallback.encodings[0]).not.toHaveProperty("scalabilityMode");
    expect(client.getSnapshot().error).toBeNull();
  });

  it("prefers VP9 for the share without dropping the fallbacks", async () => {
    vi.stubGlobal("RTCRtpSender", {
      getCapabilities: () => ({ codecs: [{ mimeType: "video/VP8" }, { mimeType: "video/VP9" }] }),
    });
    const client = build();
    const pc = await answered(client);

    await client.startScreenShare();

    const ordered = pc.transceivers[1]?.setCodecPreferences.mock.calls[0]?.[0] as RTCRtpCodec[];
    expect(ordered.map((codec) => codec.mimeType)).toEqual(["video/VP9", "video/VP8"]);
  });

  it("stops the capture when the share stops, so the browser's sharing bar goes away", async () => {
    const picture = fakeTrack("video");
    getDisplayMedia.mockResolvedValueOnce(new FakeMediaStream([picture], "screen-a"));
    const client = build();
    await answered(client);
    await client.startScreenShare();

    await client.stopScreenShare();

    expect(picture.stop).toHaveBeenCalled();
    expect(client.getSnapshot().localScreen).toBeNull();
  });

  it("stops exactly once when the browser's own Stop button ends it", async () => {
    const picture = fakeTrack("video");
    getDisplayMedia.mockResolvedValueOnce(new FakeMediaStream([picture], "screen-a"));
    const client = build();
    const pc = await answered(client);
    await client.startScreenShare();

    // Chromium ends the track when the person stops sharing from its bar.
    const ended = picture.onended as unknown as () => void;
    ended();
    ended();

    await vi.waitFor(() => expect(client.getSnapshot().localScreen).toBeNull());
    expect(pc.removeTrack).toHaveBeenCalledTimes(1);
  });

  it("reports a blocked share but treats cancelling as a non-event", async () => {
    const client = build();
    await answered(client);

    getDisplayMedia.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    await client.startScreenShare();
    // Pressing Escape is a decision, not an error worth showing.
    expect(client.getSnapshot()).toMatchObject({ error: null, screenSharePending: false });

    getDisplayMedia.mockRejectedValueOnce(
      new DOMException("Permission denied by system", "NotAllowedError"),
    );
    await client.startScreenShare();
    expect(client.getSnapshot().error).toMatchObject({ kind: "screen-share", recoverable: true });
  });
});

describe("camera", () => {
  function cameraCapture(id = "cam-a") {
    const video = fakeTrack("video");
    return { video, stream: new FakeMediaStream([video], id) };
  }

  it("captures video only, from the chosen camera, and sends it holding the frame rate", async () => {
    settings = { ...settings, videoDeviceId: "camera-2" };
    const client = build();
    const pc = await answered(client);
    const { video, stream } = cameraCapture();
    getUserMedia.mockResolvedValueOnce(stream);

    await client.startCamera();

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: "camera-2" } }),
    });
    expect(client.getSnapshot().localCamera).toEqual({ streamId: "cam-a", stream });
    expect(pc.transceivers[1]?.sender.track).toBe(video);
    expect(pc.transceivers[1]?.sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ degradationPreference: "maintain-framerate" }),
    );
  });

  it("opens the system camera, and remembers that, when the chosen one is gone", async () => {
    settings = { ...settings, videoDeviceId: "missing-usb-camera" };
    const updateSettings = vi.fn();
    const client = build({ updateSettings });
    await answered(client);
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
      .mockResolvedValueOnce(cameraCapture().stream);

    await client.startCamera();

    expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null });
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      localCamera: { streamId: "cam-a" },
    });
  });

  it("withdraws the section and releases the device when the camera stops", async () => {
    const client = build();
    const pc = await answered(client);
    const { video, stream } = cameraCapture();
    getUserMedia.mockResolvedValueOnce(stream);
    await client.startCamera();
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(2));
    await answerOffer(pc);

    await client.stopCamera();

    expect(pc.removeTrack).toHaveBeenCalledTimes(1);
    expect(pc.transceivers[1]?.direction).toBe("inactive");
    expect(video.stop).toHaveBeenCalled();
    expect(client.getSnapshot().localCamera).toBeNull();
    await vi.waitFor(() => expect(realtime.mediaOfKind("offer")).toHaveLength(3));
  });

  it("keeps the call when camera access is denied", async () => {
    const client = build();
    await answered(client);
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    await client.startCamera();

    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      cameraPending: false,
      localCamera: null,
      error: { kind: "camera", recoverable: true },
    });
  });

  it("switches to another camera without leaving the call", async () => {
    const client = build();
    const pc = await answered(client);
    getUserMedia.mockResolvedValueOnce(cameraCapture("cam-1").stream);
    await client.startCamera();
    const second = cameraCapture("cam-2");
    getUserMedia.mockResolvedValueOnce(second.stream);

    await client.applySettings({ ...settings, videoDeviceId: "camera-2" });

    const sender = pc.transceivers[1]!.sender;
    expect(sender.replaceTrack).toHaveBeenCalledWith(second.video);
    // Still in the voice's stream, so the others keep it in sync with the voice.
    expect(sender.setStreams).not.toHaveBeenCalled();
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
    expect(realtime.openMediaSession).toHaveBeenCalledTimes(1);
  });

  it("falls back to the system camera when the active one is unplugged", async () => {
    settings = { ...settings, videoDeviceId: "camera-usb" };
    const updateSettings = vi.fn();
    const client = build({ updateSettings });
    const pc = await answered(client);
    const first = cameraCapture("cam-1");
    getUserMedia.mockResolvedValueOnce(first.stream);
    await client.startCamera();
    const fallback = cameraCapture("cam-2");
    getUserMedia.mockResolvedValueOnce(fallback.stream);

    (first.video.onended as unknown as () => void)();

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null }));
    await vi.waitFor(() =>
      expect(pc.transceivers[1]?.sender.replaceTrack).toHaveBeenCalledWith(fallback.video),
    );
    expect(client.getSnapshot()).toMatchObject({ connection: "connected", localCamera: { streamId: "cam-2" } });
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
  });

  it("applies a new camera quality to the capture and the sender without leaving", async () => {
    const client = build();
    const pc = await answered(client);
    getUserMedia.mockResolvedValueOnce(cameraCapture("cam-1").stream);
    await client.startCamera();
    const sender = pc.transceivers[1]!.sender;
    sender.setParameters.mockClear();
    const second = cameraCapture("cam-2");
    getUserMedia.mockResolvedValueOnce(second.stream);

    await client.applySettings({ ...settings, cameraQuality: "sharp" });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
      }),
    });
    expect(sender.replaceTrack).toHaveBeenCalledWith(second.video);
    expect(sender.setParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({ encodings: [expect.objectContaining({ maxBitrate: 3_000_000 })] }),
    );
    expect(realtime.leaveVoice).not.toHaveBeenCalled();
  });
});
