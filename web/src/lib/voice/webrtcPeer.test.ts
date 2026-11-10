import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARTICIPANT_PREFERENCE } from "./participantPreferences";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import {
  applyEncoding,
  createPeer,
  Negotiator,
  type NegotiatorEnv,
  type Peer,
  type PeerInit,
} from "./webrtcPeer";

const SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
  "a=mid:0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:0 PCMU/8000",
  "",
].join("\r\n");

class FakeSender {
  parameters = { encodings: [{}] } as unknown as RTCRtpSendParameters;
  getParameters = vi.fn(() => this.parameters);
  setParameters = vi.fn(async (next: RTCRtpSendParameters) => {
    this.parameters = next;
  });
}

class FakeTransceiver {
  mid = "0";
  setCodecPreferences = vi.fn();
  constructor(readonly sender: FakeSender) {}
}

class FakeConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  transceivers: FakeTransceiver[] = [];
  addedCandidates: Array<RTCIceCandidateInit | undefined> = [];

  constructor(readonly config: RTCConfiguration) {}

  getTransceivers = () => this.transceivers;
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
}

let created: FakeConnection[];
let settings: VoiceSettings;
let sent: Array<{ type: string; sdp: string }>;
let env: NegotiatorEnv;
let learned: Peer[];

beforeEach(() => {
  created = [];
  settings = { ...DEFAULT_SETTINGS };
  sent = [];
  learned = [];
  env = {
    settings: () => settings,
    bitrate: () => 96_000,
    send: async (_peer, type, sdp) => {
      sent.push({ type, sdp });
    },
    remoteMediaLearned: (peer) => learned.push(peer),
  };
  vi.stubGlobal(
    "RTCPeerConnection",
    class extends FakeConnection {
      constructor(config: RTCConfiguration) {
        super(config);
        created.push(this);
      }
    },
  );
  vi.stubGlobal("RTCRtpReceiver", {
    getCapabilities: () => ({
      codecs: [
        { mimeType: "audio/PCMU", clockRate: 8000 },
        { mimeType: "audio/opus", clockRate: 48000, channels: 2 },
      ],
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function peerInit(overrides: Partial<PeerInit> = {}): PeerInit {
  return {
    user: { userId: "u-z", displayName: "Ola", muted: false },
    selfUserId: "u-a",
    iceServers: [{ urls: "stun:example.test" }],
    preference: { ...DEFAULT_PARTICIPANT_PREFERENCE },
    createVoice: () => ({
      audio: document.createElement("audio"),
      decoder: document.createElement("audio"),
      processed: false,
      streamId: null,
    }),
    recovery: { graceMs: 10, maxAttempts: 3, onEscalate: vi.fn(), onExhausted: vi.fn() },
    ...overrides,
  };
}

function newPeer(userId = "u-z", selfUserId = "u-a"): Peer {
  return createPeer(
    peerInit({ user: { userId, displayName: "Ola", muted: false }, selfUserId }),
  );
}

function fake(peer: Peer): FakeConnection {
  return peer.connection as unknown as FakeConnection;
}

describe("createPeer", () => {
  it("bundles all media on one transport using the servers it was given", () => {
    newPeer();

    expect(created[0]?.config).toEqual({
      iceServers: [{ urls: "stun:example.test" }],
      bundlePolicy: "max-bundle",
    });
  });

  it("builds no sinks for a connection that cannot be created", () => {
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        constructor() {
          throw new SyntaxError("invalid ICE server url");
        }
      },
    );
    const createVoice = vi.fn(peerInit().createVoice);

    expect(() => createPeer(peerInit({ createVoice }))).toThrow("invalid ICE server url");
    expect(createVoice).not.toHaveBeenCalled();
  });

  it("makes the lexicographically larger user id the polite side", () => {
    expect(newPeer("u-z", "u-a").polite).toBe(false);
    expect(newPeer("u-a", "u-z").polite).toBe(true);
  });

  it("starts from how this account last heard the person", () => {
    const peer = createPeer(
      peerInit({
        user: { userId: "u-z", displayName: "Ola", muted: true },
        preference: { volume: 40, gated: true, suppressed: true },
      }),
    );

    expect(peer).toMatchObject({
      displayName: "Ola",
      muted: true,
      playbackVolume: 40,
      gated: true,
      suppressed: true,
    });
  });

  it("holds candidates back until the remote description is set", async () => {
    const peer = newPeer();
    await peer.candidates.add({ candidate: "candidate:a", sdpMid: "0" });
    expect(fake(peer).addedCandidates).toEqual([]);

    fake(peer).remoteDescription = { type: "answer", sdp: SDP };
    await peer.candidates.flush();

    expect(fake(peer).addedCandidates.map((candidate) => candidate?.candidate)).toEqual([
      "candidate:a",
    ]);
  });

  it("hands the recovery watchdog's decisions to its owner with the peer", () => {
    vi.useFakeTimers();
    const onEscalate = vi.fn();
    const peer = createPeer(
      peerInit({ recovery: { graceMs: 10, maxAttempts: 1, onEscalate, onExhausted: vi.fn() } }),
    );

    peer.watchdog.arm();
    vi.advanceTimersByTime(10);

    expect(onEscalate).toHaveBeenCalledWith(peer);
    peer.watchdog.dispose();
    vi.useRealTimers();
  });
});

describe("Negotiator.offer", () => {
  it("sends an offer tuned to the selected Opus profile", async () => {
    const peer = newPeer();
    peer.micSender = new FakeSender() as unknown as RTCRtpSender;
    fake(peer).transceivers = [new FakeTransceiver(peer.micSender as unknown as FakeSender)];
    settings = { ...settings, opusProfile: "studio" };

    await new Negotiator(env).offer(peer);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("offer");
    expect(sent[0]?.sdp).toContain("maxaveragebitrate=256000");
    expect(sent[0]?.sdp).toContain("useinbandfec=1");
  });

  it("flags the offer in progress so a colliding one can be recognised", async () => {
    const peer = newPeer();
    let flagged = false;
    fake(peer).setLocalDescription.mockImplementationOnce(async () => {
      flagged = peer.makingOffer;
    });

    await new Negotiator(env).offer(peer);

    expect(flagged).toBe(true);
    expect(peer.makingOffer).toBe(false);
  });

  it("falls back to the untouched description when the stack rejects the edit", async () => {
    const peer = newPeer();
    fake(peer).setLocalDescription.mockRejectedValueOnce(new Error("InvalidModification"));

    await new Negotiator(env).offer(peer);

    expect(fake(peer).setLocalDescription).toHaveBeenLastCalledWith({
      type: "offer",
      sdp: SDP,
    });
    expect(sent).toEqual([{ type: "offer", sdp: SDP }]);
  });

  it("never rejects, and clears the flag, when the offer cannot be made", async () => {
    const peer = newPeer();
    fake(peer).createOffer.mockRejectedValueOnce(new Error("closed"));

    await expect(new Negotiator(env).offer(peer)).resolves.toBeUndefined();

    expect(peer.makingOffer).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("Negotiator.receive", () => {
  const offer: RTCSessionDescriptionInit = { type: "offer", sdp: SDP };
  const answer: RTCSessionDescriptionInit = { type: "answer", sdp: SDP };

  it("answers an offer when nothing is in flight", async () => {
    const peer = newPeer("u-a", "u-z");

    await new Negotiator(env).receive(peer, offer);

    expect(fake(peer).setRemoteDescription).toHaveBeenCalledWith(offer);
    expect(sent.map((item) => item.type)).toEqual(["answer"]);
  });

  it("applies an answer without replying", async () => {
    const peer = newPeer();
    fake(peer).signalingState = "have-local-offer";

    await new Negotiator(env).receive(peer, answer);

    expect(fake(peer).setRemoteDescription).toHaveBeenCalledWith(answer);
    expect(sent).toHaveLength(0);
  });

  it("drops a colliding offer on the impolite side", async () => {
    const peer = newPeer("u-z", "u-a");
    fake(peer).signalingState = "have-local-offer";

    await new Negotiator(env).receive(peer, offer);

    expect(fake(peer).setRemoteDescription).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("yields to a colliding offer on the polite side and answers it", async () => {
    const peer = newPeer("u-a", "u-z");
    fake(peer).signalingState = "have-local-offer";

    await new Negotiator(env).receive(peer, offer);

    expect(fake(peer).setRemoteDescription).toHaveBeenCalledWith(offer);
    expect(sent.map((item) => item.type)).toEqual(["answer"]);
  });

  it("treats an offer made while we are offering as a collision", async () => {
    const peer = newPeer("u-z", "u-a");
    peer.makingOffer = true;

    await new Negotiator(env).receive(peer, offer);

    expect(fake(peer).setRemoteDescription).not.toHaveBeenCalled();
  });

  it("rolls back by hand when implicit rollback is unsupported", async () => {
    const peer = newPeer("u-a", "u-z");
    fake(peer).signalingState = "have-local-offer";
    fake(peer).setRemoteDescription.mockRejectedValueOnce(new Error("InvalidStateError"));

    await new Negotiator(env).receive(peer, offer);

    expect(fake(peer).setLocalDescription).toHaveBeenCalledWith({ type: "rollback" });
    expect(fake(peer).setRemoteDescription).toHaveBeenCalledTimes(2);
  });

  it("reports a failure that is not a collision", async () => {
    const peer = newPeer();
    fake(peer).signalingState = "have-local-offer";
    fake(peer).setRemoteDescription.mockRejectedValueOnce(new Error("bad sdp"));

    await expect(new Negotiator(env).receive(peer, answer)).rejects.toThrow("bad sdp");
    expect(peer.settingRemoteAnswerPending).toBe(false);
  });

  it("learns which streams carry video from the description, before it answers", async () => {
    const peer = newPeer("u-a", "u-z");
    const withVideo = [
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=mid:1",
      "a=msid:share-stream share-track",
      "",
    ].join("\r\n");
    env.send = async () => {
      expect(learned).toEqual([peer]);
    };

    await new Negotiator(env).receive(peer, { type: "offer", sdp: withVideo });

    expect(peer.media.roleOf("share-stream")).toBe("screen");
    expect(peer.media.roleOf("mic-stream")).toBe("microphone");
  });

  it("applies queued candidates in order once the description is in", async () => {
    const peer = newPeer();
    fake(peer).signalingState = "have-local-offer";
    for (const name of ["a", "b"]) {
      await peer.candidates.add({ candidate: `candidate:${name}`, sdpMid: "0" });
    }
    expect(fake(peer).addIceCandidate).not.toHaveBeenCalled();

    await new Negotiator(env).receive(peer, answer);

    expect(fake(peer).addedCandidates.map((candidate) => candidate?.candidate)).toEqual([
      "candidate:a",
      "candidate:b",
    ]);
  });
});

describe("Negotiator.tuneMicSender", () => {
  it("offers Opus first and caps the encoder at the current ceiling", async () => {
    const peer = newPeer();
    const sender = new FakeSender();
    const transceiver = new FakeTransceiver(sender);
    peer.micSender = sender as unknown as RTCRtpSender;
    fake(peer).transceivers = [transceiver];

    new Negotiator(env).tuneMicSender(peer);

    const ordered = transceiver.setCodecPreferences.mock.calls[0]?.[0] as RTCRtpCodec[];
    expect(ordered[0]?.mimeType).toBe("audio/opus");
    await vi.waitFor(() => expect(sender.setParameters).toHaveBeenCalled());
    expect(sender.parameters.encodings[0]?.maxBitrate).toBe(96_000);
  });

  it("does nothing for a peer without a microphone", () => {
    const peer = newPeer();
    expect(() => new Negotiator(env).tuneMicSender(peer)).not.toThrow();
  });
});

describe("applyEncoding", () => {
  it("raises the priority of voice along with the ceiling", async () => {
    const sender = new FakeSender();

    await applyEncoding(sender as unknown as RTCRtpSender, 64_000);

    expect(sender.parameters.encodings[0]).toMatchObject({
      maxBitrate: 64_000,
      networkPriority: "high",
      priority: "high",
    });
  });

  it("leaves a sender that is already configured alone", async () => {
    const sender = new FakeSender();
    await applyEncoding(sender as unknown as RTCRtpSender, 64_000);
    sender.setParameters.mockClear();

    await applyEncoding(sender as unknown as RTCRtpSender, 64_000);

    expect(sender.setParameters).not.toHaveBeenCalled();
  });

  it("swallows a browser that refuses new parameters", async () => {
    const sender = new FakeSender();
    sender.setParameters.mockRejectedValueOnce(new Error("InvalidModificationError"));

    await expect(
      applyEncoding(sender as unknown as RTCRtpSender, 64_000),
    ).resolves.toBeUndefined();
  });
});
