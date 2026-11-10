import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { DEFAULT_PARTICIPANT_PREFERENCE } from "./participantPreferences";
import { RemoteVoiceMixer } from "./remoteMixer";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import type { SpeechDetector } from "./vad";
import { createPeer, type Peer } from "./webrtcPeer";
import { RemoteAudio } from "./webrtcRemoteAudio";

let streamCounter = 0;

function fakeStream(): MediaStream {
  return { id: `stream-${streamCounter++}` } as MediaStream;
}

function fakeTrack(): MediaStreamTrack {
  return { kind: "audio", onended: null } as unknown as MediaStreamTrack;
}

function endTrack(track: MediaStreamTrack): void {
  (track.onended as unknown as () => void)();
}

let settings: VoiceSettings;
let peers: Map<string, Peer>;
let speech: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let changed: Mock<() => void>;
let forgetOutputDevice: Mock<() => void>;
let audio: RemoteAudio;

function addPeer(userId = "u-z"): Peer {
  const peer = createPeer({
    user: { userId, displayName: "Ola", muted: false },
    selfUserId: "u-a",
    iceServers: [],
    preference: { ...DEFAULT_PARTICIPANT_PREFERENCE },
    createVoice: () => audio.createVoice(),
    recovery: { graceMs: 10, maxAttempts: 3, onEscalate: vi.fn(), onExhausted: vi.fn() },
  });
  peers.set(userId, peer);
  return peer;
}

/** Make the mixer behave as if Web Audio were available. */
function withWebAudio(resumes = true) {
  return {
    attach: vi.spyOn(RemoteVoiceMixer.prototype, "attach").mockReturnValue(true),
    resume: vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockResolvedValue(resumes),
    remove: vi.spyOn(RemoteVoiceMixer.prototype, "remove").mockImplementation(() => undefined),
    setVolume: vi.spyOn(RemoteVoiceMixer.prototype, "setVolume").mockImplementation(() => undefined),
    setGate: vi.spyOn(RemoteVoiceMixer.prototype, "setGate").mockResolvedValue(true),
    setSuppressor: vi.spyOn(RemoteVoiceMixer.prototype, "setSuppressor").mockResolvedValue(true),
  };
}

beforeEach(() => {
  settings = { ...DEFAULT_SETTINGS };
  peers = new Map();
  speech = { add: vi.fn(async () => true), remove: vi.fn() };
  changed = vi.fn<() => void>();
  forgetOutputDevice = vi.fn<() => void>();
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      remoteDescription = null;
      addIceCandidate = vi.fn();
    },
  );
  audio = new RemoteAudio({
    peers,
    speech: speech as unknown as SpeechDetector,
    settings: () => settings,
    forgetOutputDevice,
    changed,
  });
});

afterEach(() => {
  audio.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RemoteAudio sinks", () => {
  it("creates the audible sink before the always-muted decoder sink", () => {
    const { voice } = addPeer();

    const elements = [...document.querySelectorAll("[data-stellarr-voice-audio] audio")];
    expect(elements).toEqual([voice.audio, voice.decoder]);
    expect(voice.audio.muted).toBe(false);
    expect(voice.decoder.muted).toBe(true);
    expect(voice.audio.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts a sink created while deafened already muted", () => {
    audio.setDeafened(true);

    expect(addPeer().voice.audio.muted).toBe(true);
  });

  it("removes its container with removeHost and builds a fresh one for the next call", () => {
    addPeer();
    audio.removeHost();
    expect(document.querySelector("[data-stellarr-voice-audio]")).toBeNull();

    addPeer("u-y");
    expect(document.querySelectorAll("[data-stellarr-voice-audio]")).toHaveLength(1);
  });
});

describe("RemoteAudio routing without Web Audio", () => {
  it("plays the raw stream on the audible sink at the combined volume", () => {
    settings = { ...settings, outputVolume: 50 };
    const peer = addPeer();
    peer.playbackVolume = 80;
    const stream = fakeStream();

    audio.receive(peer, stream, fakeTrack());

    expect(peer.voice).toMatchObject({ processed: false, streamId: stream.id });
    expect(peer.voice.audio.srcObject).toBe(stream);
    expect(peer.voice.decoder.srcObject).toBeNull();
    expect(peer.voice.audio.volume).toBeCloseTo(0.4);
    expect(changed).toHaveBeenCalled();
    expect(speech.add).toHaveBeenCalledWith("u-z", stream);
  });

  it("applies a changed participant volume to the element itself", () => {
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());

    peer.playbackVolume = 30;
    audio.applyVolume(peer);

    expect(peer.voice.audio.volume).toBeCloseTo(0.3);
  });

  it("keeps a gate request until a strip exists to carry it", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());
    mixer.attach.mockClear();
    peer.voice.processed = false;

    peer.gated = true;
    peer.suppressed = true;
    audio.applyGate(peer);
    audio.applySuppression(peer);

    expect(mixer.setGate).not.toHaveBeenCalled();
    expect(mixer.setSuppressor).not.toHaveBeenCalled();
  });
});

describe("RemoteAudio routing through the mixer", () => {
  it("keeps the raw stream on the decoder sink and off the audible one", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    peer.playbackVolume = 120;
    peer.gated = true;
    const stream = fakeStream();

    audio.receive(peer, stream, fakeTrack());

    expect(mixer.attach).toHaveBeenCalledWith("u-z", stream, peer.voice.audio, 120, {
      gated: true,
      suppressed: false,
    });
    expect(peer.voice.processed).toBe(true);
    expect(peer.voice.decoder.srcObject).toBe(stream);
    expect(peer.voice.audio.srcObject).not.toBe(stream);
  });

  it("hands a participant's volume, gate and suppression to the strip", async () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());
    peer.playbackVolume = 35;
    peer.gated = true;
    peer.suppressed = true;

    audio.applyVolume(peer);
    audio.applyGate(peer);
    audio.applySuppression(peer);

    expect(mixer.setVolume).toHaveBeenCalledWith("u-z", 35);
    expect(mixer.setGate).toHaveBeenCalledWith("u-z", true);
    expect(mixer.setSuppressor).toHaveBeenCalledWith("u-z", true);
  });

  it("survives a gate that cannot be built", async () => {
    const mixer = withWebAudio();
    mixer.setGate.mockRejectedValue(new Error("worklet failed"));
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());

    expect(() => audio.applyGate(peer)).not.toThrow();
    await Promise.resolve();
  });

  it("falls back to the raw stream when the audio context will not run", async () => {
    const mixer = withWebAudio(false);
    const peer = addPeer();
    const stream = fakeStream();

    audio.receive(peer, stream, fakeTrack());

    await vi.waitFor(() => expect(peer.voice.processed).toBe(false));
    expect(peer.voice.audio.srcObject).toBe(stream);
    expect(peer.voice.decoder.srcObject).toBeNull();
    expect(mixer.remove).toHaveBeenCalledWith("u-z");
  });

  it("falls back to the raw stream when the processed output cannot play", async () => {
    withWebAudio();
    const peer = addPeer();
    const play = vi
      .spyOn(peer.voice.audio, "play")
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const stream = fakeStream();

    audio.receive(peer, stream, fakeTrack());

    await vi.waitFor(() => expect(peer.voice.audio.srcObject).toBe(stream));
    expect(peer.voice.processed).toBe(false);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });

  it("retries playback once on the raw stream when the mixer failed to resume and play is blocked", async () => {
    withWebAudio(false);
    const peer = addPeer();
    const play = vi
      .spyOn(peer.voice.audio, "play")
      .mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    const stream = fakeStream();

    audio.receive(peer, stream, fakeTrack());

    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(peer.voice.audio.srcObject).toBe(stream);
    expect(peer.voice.processed).toBe(false);
  });

  it("does not switch a peer that was dropped while playback was being verified", async () => {
    const mixer = withWebAudio();
    mixer.resume.mockImplementation(async () => {
      peers.clear();
      return false;
    });
    const peer = addPeer();

    const stream = fakeStream();
    audio.receive(peer, stream, fakeTrack());
    await Promise.resolve();
    await Promise.resolve();

    expect(peer.voice.audio.srcObject).not.toBe(stream);
  });
});

describe("RemoteAudio stream lifecycle", () => {
  it("attaches the same stream only once however often it is re-routed", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());

    audio.route(peer);
    audio.route(peer);

    expect(mixer.attach).toHaveBeenCalledTimes(1);
  });

  it("lets the newest stream replace the older one", () => {
    const peer = addPeer();
    const first = fakeStream();
    const second = fakeStream();

    audio.receive(peer, first, fakeTrack());
    audio.receive(peer, second, fakeTrack());
    audio.route(peer);

    expect(peer.voice.streamId).toBe(second.id);
    expect(peer.voice.audio.srcObject).toBe(second);
  });

  it("detaches an ended voice instead of keeping a dead sink", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    peer.speaking = true;
    peer.level = 0.7;
    const track = fakeTrack();
    audio.receive(peer, fakeStream(), track);
    changed.mockClear();

    endTrack(track);

    expect(peer.voice).toMatchObject({ processed: false, streamId: null });
    expect(peer.voice.audio.srcObject).toBeNull();
    expect(peer.voice.decoder.srcObject).toBeNull();
    expect(peer).toMatchObject({ speaking: false, level: 0 });
    expect(speech.remove).toHaveBeenCalledWith("u-z");
    expect(mixer.remove).toHaveBeenCalledWith("u-z");
    expect(changed).toHaveBeenCalled();
  });

  it("returns to an older stream when the newest one ends", () => {
    const peer = addPeer();
    const older = fakeStream();
    const newerTrack = fakeTrack();
    audio.receive(peer, older, fakeTrack());
    audio.receive(peer, fakeStream(), newerTrack);

    endTrack(newerTrack);

    expect(peer.voice.streamId).toBe(older.id);
    expect(peer.voice.audio.srcObject).toBe(older);
  });

  it("ignores a track that ends after its peer was released", () => {
    const peer = addPeer();
    const track = fakeTrack();
    audio.receive(peer, fakeStream(), track);
    peers.delete("u-z");
    audio.release(peer);
    changed.mockClear();

    endTrack(track);

    expect(changed).not.toHaveBeenCalled();
  });

  it("frees the sinks and the strip of a released peer", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());

    audio.release(peer);

    expect(document.querySelector("[data-stellarr-voice-audio] audio")).toBeNull();
    expect(peer.voice.audio.srcObject).toBeNull();
    expect(speech.remove).toHaveBeenCalledWith("u-z");
    expect(mixer.remove).toHaveBeenCalledWith("u-z");
  });
});

describe("RemoteAudio deafening", () => {
  it("mutes every audible sink and restores them, leaving the decoder muted", () => {
    const first = addPeer("u-x");
    const second = addPeer("u-y");

    audio.setDeafened(true);
    expect([first.voice.audio.muted, second.voice.audio.muted]).toEqual([true, true]);

    audio.setDeafened(false);
    expect([first.voice.audio.muted, second.voice.audio.muted]).toEqual([false, false]);
    expect([first.voice.decoder.muted, second.voice.decoder.muted]).toEqual([true, true]);
  });

  it("keeps a voice that arrives while deafened silent", () => {
    const peer = addPeer();
    audio.setDeafened(true);

    audio.receive(peer, fakeStream(), fakeTrack());

    expect(peer.voice.audio.muted).toBe(true);
  });
});

describe("RemoteAudio output device", () => {
  const originalSetSinkId = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "setSinkId",
  );

  afterEach(() => {
    if (originalSetSinkId) {
      Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", originalSetSinkId);
    } else {
      delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
  });

  it("moves every audible sink to the chosen device", async () => {
    const setSinkId = vi.fn(async () => undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: setSinkId,
    });
    const peer = addPeer();
    settings = { ...settings, outputDeviceId: "usb-headphones" };
    setSinkId.mockClear();

    await audio.refreshOutput();

    expect(setSinkId).toHaveBeenCalledTimes(1);
    expect(setSinkId).toHaveBeenCalledWith("usb-headphones");
    expect(forgetOutputDevice).not.toHaveBeenCalled();
    expect(peer.voice.audio.volume).toBeCloseTo(settings.outputVolume / 100);
  });

  it("falls back to the system route once when the chosen device is gone", async () => {
    const setSinkId = vi.fn(async (id: string) => {
      if (id !== "") throw new DOMException("gone", "NotFoundError");
    });
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: setSinkId,
    });
    addPeer("u-x");
    addPeer("u-y");
    settings = { ...settings, outputDeviceId: "missing" };
    setSinkId.mockClear();

    await audio.refreshOutput();

    expect(setSinkId).toHaveBeenCalledWith("");
    expect(forgetOutputDevice).toHaveBeenCalledTimes(1);
  });

  it("reapplies the combined volume to raw sinks after an output change", async () => {
    const peer = addPeer();
    audio.receive(peer, fakeStream(), fakeTrack());
    peer.playbackVolume = 50;
    settings = { ...settings, outputVolume: 60 };

    await audio.refreshOutput();

    expect(peer.voice.audio.volume).toBeCloseTo(0.3);
  });
});

describe("RemoteAudio gesture and resume handling", () => {
  it("prepares the mixer and retries playback on a user gesture", () => {
    const prepare = vi.spyOn(RemoteVoiceMixer.prototype, "prepare").mockImplementation(() => undefined);
    const peer = addPeer();
    const play = vi.spyOn(peer.voice.audio, "play");
    const decoderPlay = vi.spyOn(peer.voice.decoder, "play");

    audio.prepare();

    expect(prepare).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
    expect(decoderPlay).toHaveBeenCalled();
  });

  it("resumes the mixer before retrying playback after a background spell", async () => {
    const order: string[] = [];
    vi.spyOn(RemoteVoiceMixer.prototype, "resume").mockImplementation(async () => {
      order.push("resume");
      return true;
    });
    const peer = addPeer();
    vi.spyOn(peer.voice.audio, "play").mockImplementation(async () => {
      order.push("play");
    });

    await audio.resume();

    expect(order).toEqual(["resume", "play"]);
  });

  it("forwards the playback profile to the mixer", () => {
    const setProfile = vi
      .spyOn(RemoteVoiceMixer.prototype, "setProfile")
      .mockImplementation(() => undefined);

    audio.setProfile("studio", settings.playbackTuning);

    expect(setProfile).toHaveBeenCalledWith("studio", settings.playbackTuning);
  });
});
