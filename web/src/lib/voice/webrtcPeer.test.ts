import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import {
  addSender,
  applyEncoding,
  createLink,
  Negotiator,
  type Link,
  type LinkRecovery,
  type NegotiatorEnv,
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
  mid: string | null = "0";
  setCodecPreferences = vi.fn();
  constructor(readonly sender: FakeSender) {}
}

class FakeConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  transceivers: FakeTransceiver[] = [];

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
  addTrack = vi.fn(() => {
    throw new Error("a link to the media server publishes on transceivers of its own");
  });
  addTransceiver = vi.fn(
    (_track: MediaStreamTrack, _init: { direction: RTCRtpTransceiverDirection; streams: MediaStream[] }) => {
      const transceiver = new FakeTransceiver(new FakeSender());
      this.transceivers.push(transceiver);
      return transceiver;
    },
  );
}

let created: FakeConnection[];
let settings: VoiceSettings;
let sent: Array<{ type: string; sdp: string }>;
let env: NegotiatorEnv;

beforeEach(() => {
  created = [];
  settings = { ...DEFAULT_SETTINGS };
  sent = [];
  env = {
    settings: () => settings,
    bitrate: () => 96_000,
    send: async (_link, type, sdp) => {
      sent.push({ type, sdp });
    },
    screenAudioStereo: () => true,
    audioUse: () => null,
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

function recovery(overrides: Partial<LinkRecovery> = {}): LinkRecovery {
  return { graceMs: 10, maxAttempts: 1, onEscalate: vi.fn(), onExhausted: vi.fn(), ...overrides };
}

/** The connection to the media server, which is what negotiation works on. */
function newPeer(): Link {
  return createLink({ iceServers: [{ urls: "stun:example.test" }], recovery: recovery() });
}

function fake(peer: Link): FakeConnection {
  return peer.connection as unknown as FakeConnection;
}

describe("createLink", () => {
  it("bundles all media on one transport using the servers it was given", () => {
    newPeer();

    expect(created[0]?.config).toEqual({
      iceServers: [{ urls: "stun:example.test" }],
      bundlePolicy: "max-bundle",
    });
  });

  it("hands the recovery watchdog's decisions to its owner with the link", () => {
    vi.useFakeTimers();
    const onEscalate = vi.fn();
    const link = createLink({
      iceServers: [],
      recovery: recovery({ onEscalate }),
    });

    link.watchdog.arm();
    vi.advanceTimersByTime(10);

    expect(onEscalate).toHaveBeenCalledWith(link);
    link.watchdog.dispose();
    vi.useRealTimers();
  });
});

describe("addSender", () => {
  it("publishes on a send-only transceiver of its own, never with addTrack", () => {
    const link = newPeer();
    const track = { kind: "audio" } as MediaStreamTrack;
    const stream = { id: "mic" } as MediaStream;

    const sender = addSender(link, track, stream);

    expect(fake(link).addTransceiver).toHaveBeenCalledWith(track, {
      direction: "sendonly",
      streams: [stream],
    });
    expect(fake(link).addTrack).not.toHaveBeenCalled();
    expect(sender).toBe(fake(link).transceivers[0]?.sender);
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

  describe("with a share's sound beside the microphone", () => {
    const twoSections = [
      "v=0",
      ...["0", "1"].flatMap((mid) => [
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        `a=mid:${mid}`,
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 minptime=10;useinbandfec=1",
      ]),
      "",
    ].join("\r\n");

    async function offerWith(stereo: boolean): Promise<string[]> {
      env.screenAudioStereo = () => stereo;
      const peer = newPeer();
      const mic = new FakeSender();
      const screen = new FakeSender();
      peer.micSender = mic as unknown as RTCRtpSender;
      peer.screenAudioSender = screen as unknown as RTCRtpSender;
      const screenSection = new FakeTransceiver(screen);
      screenSection.mid = "1";
      fake(peer).transceivers = [new FakeTransceiver(mic), screenSection];
      fake(peer).createOffer.mockResolvedValueOnce({ type: "offer", sdp: twoSections });

      await new Negotiator(env).offer(peer);

      return (sent[0]?.sdp ?? "").split("m=audio").slice(1);
    }

    it("keeps the voice mono and gives the sound stereo when its source has two channels", async () => {
      const [voice, shared] = await offerWith(true);

      expect(voice).toContain("stereo=0");
      expect(shared).toContain("stereo=1");
      expect(shared).toContain("maxaveragebitrate=160000");
      expect(shared).toContain("usedtx=0");
    });

    it("keeps the sound mono when its source has one channel", async () => {
      const [, shared] = await offerWith(false);

      expect(shared).toContain("stereo=0");
    });
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

  it("answers an offer", async () => {
    const peer = newPeer();

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

  it("rejects when the browser refuses the description, and answers nothing", async () => {
    const peer = newPeer();
    fake(peer).setRemoteDescription.mockRejectedValueOnce(new Error("bad sdp"));

    await expect(new Negotiator(env).receive(peer, offer)).rejects.toThrow("bad sdp");
    expect(sent).toHaveLength(0);
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

  it("does nothing for a link without a microphone", () => {
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
