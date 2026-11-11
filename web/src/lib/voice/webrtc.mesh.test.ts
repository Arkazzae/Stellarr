import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RealtimeClient,
  RealtimeEventMap,
  RealtimeEventName,
  VoiceSignal,
} from "@/lib/realtime/types";
import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import type { VoiceIceProvider } from "./iceSession";
import { RemoteVoiceMixer } from "./remoteMixer";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { WebRtcVoiceClient } from "./webrtc";

const CHANNEL = "ch-salon";
const SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
  "a=mid:0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:0 PCMU/8000",
  "",
].join("\r\n");

// ---- fakes -----------------------------------------------------------------

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
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  senders: FakeSender[] = [];
  addedCandidates: Array<RTCIceCandidateInit | undefined> = [];

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(public config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: MediaStreamTrack): FakeSender {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
  }

  getTransceivers = () =>
    this.senders.map((sender, index) => ({
      sender,
      mid: String(index),
      setCodecPreferences: vi.fn(),
    }));
  getConfiguration = () => this.config;
  setConfiguration = vi.fn((next: RTCConfiguration) => {
    this.config = next;
  });
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: SDP }));
  createAnswer = vi.fn(async () => ({ type: "answer" as const, sdp: SDP }));
  setLocalDescription = vi.fn(async (description?: RTCSessionDescriptionInit) => {
    if (description?.type === "rollback") {
      this.signalingState = "stable";
      return;
    }
    this.localDescription = description ?? null;
    this.signalingState = description?.type === "offer" ? "have-local-offer" : "stable";
  });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  });
  addIceCandidate = vi.fn(async (candidate?: RTCIceCandidateInit) => {
    this.addedCandidates.push(candidate);
  });
  restartIce = vi.fn();
  getStats = vi.fn(async () => []);
  close = vi.fn(() => {
    this.connectionState = "closed";
  });

  setState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

class FakeRealtime implements RealtimeClient {
  sent: VoiceSignal[] = [];
  private handlers = new Map<RealtimeEventName, Array<(payload: never) => void>>();
  private statusListeners: Array<() => void> = [];

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
  joinVoice = vi.fn(async (_channelId: string) => {});
  leaveVoice = vi.fn(async () => {});
  declineDirectCall = vi.fn(async () => {});
  sendVoiceSignal = vi.fn(async (signal: VoiceSignal) => {
    this.sent.push(signal);
  });
  openMediaSession = vi.fn(async () => "media-session-1");
  sendMediaSignal = vi.fn(async () => {});
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

  /** A signal from another participant. */
  signal(fromUserId: string, kind: VoiceSignal["kind"], payload: unknown): void {
    this.emit("VoiceSignal", {
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: CHANNEL,
      fromUserId,
      kind,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  setStatus(status: "connected" | "reconnecting"): void {
    this.getStatus.mockReturnValue(status as never);
    for (const listener of this.statusListeners) listener();
  }

  sentOfKind(kind: VoiceSignal["kind"]): VoiceSignal[] {
    return this.sent.filter((signal) => signal.kind === kind);
  }
}

function fakeTrack(): MediaStreamTrack {
  return {
    kind: "audio",
    enabled: true,
    contentHint: "",
    stop: vi.fn(),
    onended: null,
    getSettings: () => ({ channelCount: 1 }),
  } as unknown as MediaStreamTrack;
}

let streamCounter = 0;
function fakeStream(track: MediaStreamTrack = fakeTrack()): MediaStream {
  return {
    id: `stream-${streamCounter++}`,
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

const ICE: RTCIceServer[] = [{ urls: "stun:orbit.example:3478" }];

let realtime: FakeRealtime;
let ice: VoiceIceProvider & { beginSession: ReturnType<typeof vi.fn> };
let micTrack: MediaStreamTrack;
let settings: VoiceSettings;
let getUserMedia: ReturnType<typeof vi.fn>;
let clients: WebRtcVoiceClient[];
let devices: MediaDeviceInfo[];
let deviceChange: EventListener | null;

function build(selfUserId = "u-a", updateSettings?: (patch: Partial<VoiceSettings>) => void) {
  const client = new WebRtcVoiceClient({
    realtime,
    selfUserId,
    selfDisplayName: "Ja",
    ice,
    rtc: { protocolVersion: RTC_PROTOCOL_VERSION, topology: "mesh" },
    getSettings: () => settings,
    updateSettings,
    statsIntervalMs: 60_000,
    recoveryGraceMs: 20,
  });
  clients.push(client);
  return client;
}

function announce(...ids: string[]): void {
  realtime.emit("VoiceParticipantChanged", {
    channelId: CHANNEL,
    participants: ids.map((userId) => ({ userId, displayName: `Osoba ${userId}`, muted: false })),
  });
}

/** Join, then bring one other person into the channel. */
async function joinWith(client: WebRtcVoiceClient, peerId = "u-z"): Promise<FakePeerConnection> {
  await client.join(CHANNEL);
  announce(peerId);
  await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
  return FakePeerConnection.instances[0]!;
}

/** Join and wait until the newcomer has been told where we stand. */
async function joinAndSettle(client: WebRtcVoiceClient): Promise<FakePeerConnection> {
  const pc = await joinWith(client);
  await vi.waitFor(() =>
    expect(realtime.sentOfKind("state").some((frame) => frame.toUserId === "u-z")).toBe(true),
  );
  realtime.sent = [];
  return pc;
}

function peerOf(client: WebRtcVoiceClient) {
  return client.getSnapshot().peers.find((peer) => !peer.self);
}

function audioDevice(kind: MediaDeviceKind, deviceId: string): MediaDeviceInfo {
  return { kind, deviceId, groupId: "g", label: deviceId, toJSON: () => ({}) };
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
  streamCounter = 0;
  clients = [];
  realtime = new FakeRealtime();
  micTrack = fakeTrack();
  settings = { ...DEFAULT_SETTINGS };
  ice = {
    beginSession: vi.fn(async () => ICE),
    current: vi.fn(() => ICE),
    endSession: vi.fn(),
  };
  getUserMedia = vi.fn(async () => fakeStream(micTrack));
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  devices = [];
  deviceChange = null;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => devices),
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "devicechange") deviceChange = listener;
      }),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  for (const client of clients) client.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

    expect(order).toEqual(["ice", "hub"]);
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      channelId: CHANNEL,
      error: null,
      transport: { signaling: "connected", media: "ready", peerCount: 0 },
    });
    expect(client.getSnapshot().peers).toHaveLength(1);
    expect(JSON.parse(realtime.sentOfKind("state")[0]!.payload)).toEqual({
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
  });

  it("does not retry a blocked microphone on another device", async () => {
    settings = { ...settings, inputDeviceId: "usb-mic" };
    getUserMedia.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    const client = build();

    await client.join(CHANNEL);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().error?.kind).toBe("mic-denied");
  });

  it("releases the microphone and the ICE session when the hub join fails", async () => {
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub down"));
    const client = build();

    await client.join(CHANNEL);

    expect(client.getSnapshot()).toMatchObject({
      connection: "failed",
      error: { kind: "signaling" },
    });
    expect(micTrack.stop).toHaveBeenCalled();
    expect(ice.endSession).toHaveBeenCalled();
  });

  it("can be retried after the ICE configuration failed", async () => {
    ice.beginSession.mockRejectedValueOnce(new Error("offline"));
    const client = build();
    await client.join(CHANNEL);
    expect(client.getSnapshot().error?.kind).toBe("ice-config");
    expect(micTrack.stop).toHaveBeenCalled();

    await client.join(CHANNEL);

    expect(client.getSnapshot().connection).toBe("connected");
  });

  it("leaves cleanly: closes peers, stops the microphone, tells the hub", async () => {
    const client = build();
    const pc = await joinWith(client);

    await client.leave();

    expect(pc.close).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(realtime.leaveVoice).toHaveBeenCalledTimes(1);
    expect(ice.endSession).toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({ connection: "idle", channelId: null, peers: [] });
    expect(document.querySelector("[data-stellarr-voice-audio]")).toBeNull();
  });

  it("still leaves when the hub is unreachable", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.leaveVoice.mockRejectedValueOnce(new Error("hub gone"));

    await client.leave();

    expect(client.getSnapshot().channelId).toBeNull();
  });

  it("drops a join that is left while the microphone is still opening", async () => {
    const opening = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(opening.promise);
    const client = build();

    const joining = client.join(CHANNEL);
    await client.leave();
    opening.resolve(fakeStream(micTrack));
    await joining;

    expect(micTrack.stop).toHaveBeenCalled();
    expect(realtime.joinVoice).not.toHaveBeenCalled();
    expect(client.getSnapshot().channelId).toBeNull();
  });
});

describe("offer and answer", () => {
  it("opens with a tuned offer on the impolite side only", async () => {
    const impolite = build("u-a");
    const pc = await joinWith(impolite, "u-z");

    expect(pc.config).toMatchObject({ iceServers: ICE, bundlePolicy: "max-bundle" });
    expect(pc.signalingState).toBe("have-local-offer");
    const offer = realtime.sentOfKind("offer")[0]!;
    expect(offer.toUserId).toBe("u-z");
    expect(JSON.parse(offer.payload).sdp).toContain("maxaveragebitrate=128000");

    FakePeerConnection.instances = [];
    realtime.sent = [];
    const polite = build("u-z");
    const waiting = await joinWith(polite, "u-a");
    expect(waiting.signalingState).toBe("stable");
    expect(realtime.sentOfKind("offer")).toHaveLength(0);
  });

  it("puts the microphone on every peer connection", async () => {
    const client = build();
    const pc = await joinWith(client);

    expect(pc.senders).toHaveLength(1);
    expect(pc.senders[0]?.track).toBe(micTrack);
    expect(micTrack.contentHint).toBe("speech");
  });

  it("answers an offer from the other side", async () => {
    const client = build("u-z");
    const pc = await joinWith(client, "u-a");
    realtime.sent = [];

    realtime.signal("u-a", "offer", { type: "offer", sdp: SDP });

    await vi.waitFor(() => expect(realtime.sentOfKind("answer")).toHaveLength(1));
    expect(pc.remoteDescription?.type).toBe("offer");
    expect(realtime.sentOfKind("answer")[0]?.toUserId).toBe("u-a");
  });

  it("sends local candidates and the end-of-candidates marker to that peer", async () => {
    const client = build();
    const pc = await joinWith(client);
    realtime.sent = [];

    pc.onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: "candidate:1", sdpMid: "0" }) } as RTCIceCandidate,
    });
    pc.onicecandidate?.({ candidate: null });

    await vi.waitFor(() => expect(realtime.sentOfKind("candidate")).toHaveLength(2));
    const [candidate, end] = realtime.sentOfKind("candidate");
    expect(candidate?.toUserId).toBe("u-z");
    expect(JSON.parse(candidate!.payload).candidate).toBe("candidate:1");
    expect(end?.payload).toBe("null");
  });

  it("survives a frame it cannot parse, and one from someone who is not here", async () => {
    const client = build();
    await joinWith(client);

    realtime.signal("u-z", "answer", "not json");
    realtime.signal("u-nobody", "offer", { type: "offer", sdp: SDP });
    await Promise.resolve();

    expect(client.getSnapshot().connection).toBe("connected");
    expect(client.getSnapshot().error).toBeNull();
  });

  it("closes the connection of someone who left the channel", async () => {
    const client = build();
    const pc = await joinWith(client);

    announce();

    await vi.waitFor(() => expect(pc.close).toHaveBeenCalled());
    await vi.waitFor(() => expect(client.getSnapshot().peers).toHaveLength(1));
  });

  it("stops building connections once the call has been left", async () => {
    const client = build();
    await client.join(CHANNEL);

    announce("u-x", "u-y");
    await client.leave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(FakePeerConnection.instances).toHaveLength(1);
  });
});

describe("mute and deafen", () => {
  it("mutes only the outgoing track and tells everyone", async () => {
    const client = build();
    await client.join(CHANNEL);
    realtime.sent = [];

    client.setMuted(true);

    expect(micTrack.enabled).toBe(false);
    expect(client.getSnapshot()).toMatchObject({ muted: true });
    await vi.waitFor(() => expect(realtime.sentOfKind("state")).toHaveLength(1));
    expect(JSON.parse(realtime.sentOfKind("state")[0]!.payload).muted).toBe(true);

    client.setMuted(false);
    expect(micTrack.enabled).toBe(true);
  });

  it("opens the microphone muted when the person muted before joining", async () => {
    const client = build();
    client.setMuted(true);

    await client.join(CHANNEL);

    expect(micTrack.enabled).toBe(false);
    client.setMuted(false);
    expect(micTrack.enabled).toBe(true);
  });

  it("learns another person's mute state from their frame", async () => {
    const client = build();
    await joinWith(client);

    realtime.signal("u-z", "state", {
      muted: true,
      screenStreamId: null,
      cameraStreamId: null,
    });

    expect(peerOf(client)?.muted).toBe(true);
  });

});

describe("remote voice", () => {
  function arrive(pc: FakePeerConnection, stream = fakeStream()): MediaStream {
    pc.ontrack?.({ track: stream.getAudioTracks()[0]!, streams: [stream] });
    return stream;
  }

  it("routes a remote voice through the mixer and keeps the raw stream off the speakers", async () => {
    const attach = vi.spyOn(RemoteVoiceMixer.prototype, "attach").mockReturnValue(true);
    vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockResolvedValue(true);
    const setVolume = vi
      .spyOn(RemoteVoiceMixer.prototype, "setVolume")
      .mockImplementation(() => undefined);
    const client = build();
    const pc = await joinWith(client);

    const stream = arrive(pc);

    const [audible, decoder] = [...document.querySelectorAll("[data-stellarr-voice-audio] audio")];
    expect(attach).toHaveBeenCalledWith("u-z", stream, audible, 100, {
      gated: false,
      suppressed: false,
    });
    expect((decoder as HTMLAudioElement).srcObject).toBe(stream);
    expect((audible as HTMLAudioElement).srcObject).not.toBe(stream);

    client.setPeerVolume("u-z", 150);
    expect(setVolume).toHaveBeenCalledWith("u-z", 150);
    expect(peerOf(client)?.playbackVolume).toBe(150);
  });

  it("deafening still mutes the audible sink of a processed voice", async () => {
    vi.spyOn(RemoteVoiceMixer.prototype, "attach").mockReturnValue(true);
    vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockResolvedValue(true);
    const client = build();
    const pc = await joinWith(client);
    arrive(pc);
    const audible = document.querySelector("[data-stellarr-voice-audio] audio") as HTMLAudioElement;

    client.setDeafened(true);

    expect(audible.muted).toBe(true);
  });

  it("plays the raw stream when Web Audio is unavailable", async () => {
    const client = build();
    const pc = await joinWith(client);

    const stream = arrive(pc);

    const audible = document.querySelector("[data-stellarr-voice-audio] audio") as HTMLAudioElement;
    expect(audible.srcObject).toBe(stream);
    client.setPeerVolume("u-z", 50);
    expect(audible.volume).toBeCloseTo(0.5);
  });

  it("shows a remote share and camera only once the person announced them", async () => {
    const client = build();
    const pc = await joinWith(client);
    const share = fakeStream();
    const camera = fakeStream();
    const arriveVideo = (stream: MediaStream) =>
      pc.ontrack?.({ track: { ...fakeTrack(), kind: "video" } as MediaStreamTrack, streams: [stream] });

    arriveVideo(share);
    arriveVideo(camera);
    expect(peerOf(client)).toMatchObject({ screen: null, camera: null });

    realtime.signal("u-z", "state", {
      muted: false,
      screenStreamId: share.id,
      cameraStreamId: camera.id,
    });

    expect(peerOf(client)?.screen).toMatchObject({ streamId: share.id, stream: share });
    expect(peerOf(client)?.camera).toMatchObject({ streamId: camera.id, stream: camera });
    expect(document.querySelector("video")).toBeNull();
  });

  it("clamps an absurd volume", async () => {
    const client = build();
    await joinWith(client);

    client.setPeerVolume("u-z", 900);

    expect(peerOf(client)?.playbackVolume).toBe(200);
  });
});

describe("live settings", () => {
  it("applies a profile change without reopening the microphone, and renegotiates", async () => {
    const client = build();
    const pc = await joinWith(client);
    pc.signalingState = "stable";
    realtime.sent = [];

    await client.applySettings({ ...settings, opusProfile: "studio" });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(pc.senders[0]?.parameters.encodings[0]?.maxBitrate).toBe(256_000);
    await vi.waitFor(() => expect(realtime.sentOfKind("offer")).toHaveLength(1));
    expect(JSON.parse(realtime.sentOfKind("offer")[0]!.payload).sdp).toContain(
      "maxaveragebitrate=256000",
    );
  });

  it("tells everyone its state again once the microphone moved", async () => {
    const client = build();
    await joinAndSettle(client);
    getUserMedia.mockResolvedValueOnce(fakeStream(fakeTrack()));

    await client.applySettings({ ...settings, inputDeviceId: "other-mic" });

    await vi.waitFor(() => expect(realtime.sentOfKind("state")).toHaveLength(1));
    const [frame] = realtime.sentOfKind("state");
    expect(frame?.toUserId).toBeUndefined();
    expect(JSON.parse(frame!.payload)).toEqual({
      muted: false,
      screenStreamId: null,
      cameraStreamId: null,
    });
  });

  it("sends no state when the microphone did not move", async () => {
    const client = build();
    await joinAndSettle(client);

    await client.applySettings({ ...settings, vadSensitivity: 80 });
    getUserMedia.mockRejectedValueOnce(new DOMException("gone", "NotFoundError"));
    await client.applySettings({ ...settings, vadSensitivity: 80, inputDeviceId: "unplugged" });

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(realtime.sentOfKind("state")).toEqual([]);
  });

  it("forgets a chosen microphone that was unplugged", async () => {
    devices = [audioDevice("audioinput", "usb-mic")];
    settings = { ...settings, inputDeviceId: "usb-mic" };
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);
    await client.join(CHANNEL);
    await vi.waitFor(() => expect(deviceChange).not.toBeNull());
    await Promise.resolve();
    getUserMedia.mockResolvedValueOnce(fakeStream(fakeTrack()));

    devices = [];
    deviceChange?.(new Event("devicechange"));

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ inputDeviceId: null }), {
      timeout: 1000,
    });
    await vi.waitFor(() => expect(micTrack.stop).toHaveBeenCalled());
  });

  describe("with the camera on", () => {
    function cameraOn() {
      const video = { ...fakeTrack(), kind: "video" } as MediaStreamTrack;
      const media = {
        id: `camera-${streamCounter++}`,
        getTracks: () => [video],
        getAudioTracks: () => [],
        getVideoTracks: () => [video],
      } as unknown as MediaStream;
      return { video, media };
    }

    async function startCamera(client: WebRtcVoiceClient) {
      devices = [audioDevice("videoinput", "cam-a"), audioDevice("videoinput", "cam-b")];
      const pc = await joinWith(client);
      await vi.waitFor(() => expect(deviceChange).not.toBeNull());
      await Promise.resolve();
      const first = cameraOn();
      getUserMedia.mockResolvedValueOnce(first.media);
      await client.startCamera();
      return { pc, first };
    }

    it("reopens a camera that follows the system default when the cameras change", async () => {
      const client = build();
      const { pc, first } = await startCamera(client);
      const second = cameraOn();
      getUserMedia.mockResolvedValueOnce(second.media);

      devices = [audioDevice("videoinput", "cam-c")];
      deviceChange?.(new Event("devicechange"));

      await vi.waitFor(() => expect(pc.senders[1]?.replaceTrack).toHaveBeenCalledWith(second.video), {
        timeout: 1000,
      });
      expect(first.video.stop).toHaveBeenCalled();
      expect(micTrack.stop).not.toHaveBeenCalled();
    });

    it("moves to the system camera when the chosen one is unplugged, and forgets the choice", async () => {
      settings = { ...settings, videoDeviceId: "cam-a" };
      const updateSettings = vi.fn();
      const client = build("u-a", updateSettings);
      const { pc, first } = await startCamera(client);
      const second = cameraOn();
      getUserMedia.mockResolvedValueOnce(second.media);

      devices = [audioDevice("videoinput", "cam-b")];
      deviceChange?.(new Event("devicechange"));

      await vi.waitFor(() => expect(pc.senders[1]?.replaceTrack).toHaveBeenCalledWith(second.video), {
        timeout: 1000,
      });
      expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null });
      expect(first.video.stop).toHaveBeenCalled();
    });

    it("leaves a camera chosen by id alone when another camera comes or goes", async () => {
      settings = { ...settings, videoDeviceId: "cam-a" };
      const client = build();
      const { first } = await startCamera(client);
      const callsBefore = getUserMedia.mock.calls.length;

      devices = [audioDevice("videoinput", "cam-a")];
      deviceChange?.(new Event("devicechange"));
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(getUserMedia).toHaveBeenCalledTimes(callsBefore);
      expect(first.video.stop).not.toHaveBeenCalled();
    });
  });

  it("forgets a chosen camera that was unplugged, though no camera is on", async () => {
    devices = [audioDevice("videoinput", "cam-1")];
    settings = { ...settings, videoDeviceId: "cam-1" };
    const updateSettings = vi.fn();
    const client = build("u-a", updateSettings);
    await client.join(CHANNEL);
    await vi.waitFor(() => expect(deviceChange).not.toBeNull());
    await Promise.resolve();

    devices = [];
    deviceChange?.(new Event("devicechange"));

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ videoDeviceId: null }), {
      timeout: 1000,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(micTrack.stop).not.toHaveBeenCalled();
  });

});

describe("recovery", () => {
  it("restarts ICE after a failure and re-offers from the impolite side", async () => {
    const client = build();
    const pc = await joinWith(client);
    pc.signalingState = "stable";
    realtime.sent = [];

    pc.setState("failed");

    await vi.waitFor(() => expect(pc.restartIce).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(realtime.sentOfKind("offer")).toHaveLength(1));
    expect(client.getSnapshot().error).toBeNull();
  });

  it("waits for a polite peer's counterpart to make the restart offer", async () => {
    const client = build("u-z");
    const pc = await joinWith(client, "u-a");

    pc.setState("failed");

    await vi.waitFor(() => expect(pc.restartIce).toHaveBeenCalled());
    expect(realtime.sentOfKind("offer")).toHaveLength(0);
  });

  it("gives up after three restarts and says which connection was lost", async () => {
    const client = build();
    const pc = await joinWith(client);

    pc.setState("disconnected");

    await vi.waitFor(() => expect(client.getSnapshot().error?.kind).toBe("transport"), {
      timeout: 1000,
    });
    expect(pc.restartIce).toHaveBeenCalledTimes(3);
    expect(client.getSnapshot().error?.message).toContain("u-z");
    expect(client.getSnapshot().transport.media).toBe("failed");
  });

  it("only calls the media connected once audio crossed both ways", async () => {
    const client = build();
    const pc = await joinWith(client);
    pc.setState("connected");
    expect(client.getSnapshot().transport).toMatchObject({
      media: "connecting",
      connectedPeerCount: 1,
    });

    pc.getStats.mockResolvedValue([
      { type: "outbound-rtp", kind: "audio", packetsSent: 5, bytesSent: 400 },
      { type: "inbound-rtp", kind: "audio", packetsReceived: 5, bytesReceived: 400 },
    ] as never);
    await (client as unknown as { sampleStats(): Promise<void> }).sampleStats();

    expect(client.getSnapshot().transport.media).toBe("connected");
    expect(client.getSnapshot().diagnostics).toMatchObject({ packetsSent: 5, packetsReceived: 5 });
  });
});

describe("following the hub", () => {
  it("ignores events for another channel", async () => {
    const client = build();
    await client.join(CHANNEL);

    realtime.emit("VoiceChannelKicked", { channelId: "ch-other" });
    realtime.emit("VoiceChannelMoved", { fromChannelId: "ch-other", toChannelId: "ch-third" });

    expect(client.getSnapshot()).toMatchObject({ connection: "connected", channelId: CHANNEL });
  });

  it("ends the call when the move cannot be followed", async () => {
    const client = build();
    await joinWith(client);
    realtime.joinVoice.mockRejectedValueOnce(new Error("hub"));

    realtime.emit("VoiceChannelMoved", { fromChannelId: CHANNEL, toChannelId: "ch-nocna" });

    await vi.waitFor(() => expect(client.getSnapshot().error?.kind).toBe("signaling"));
    expect(client.getSnapshot().channelId).toBeNull();
  });

  it("stops listening to the hub once the call is left", async () => {
    const client = build();
    await joinWith(client);
    await client.leave();
    const before = FakePeerConnection.instances.length;

    announce("u-y");
    realtime.signal("u-z", "offer", { type: "offer", sdp: SDP });
    await Promise.resolve();

    expect(FakePeerConnection.instances).toHaveLength(before);
  });
});
