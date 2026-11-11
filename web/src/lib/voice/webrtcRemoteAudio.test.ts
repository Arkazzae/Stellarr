import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { DEFAULT_PARTICIPANT_PREFERENCE } from "./participantPreferences";
import { RemoteVoiceMixer } from "./remoteMixer";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import type { SpeechDetector } from "./vad";
import { createParticipant, type Participant } from "./webrtcParticipant";
import { RemoteAudio } from "./webrtcRemoteAudio";

let streamCounter = 0;

function fakeStream(): MediaStream {
  return { id: `stream-${streamCounter++}`, getAudioTracks: () => [] } as unknown as MediaStream;
}

function fakeTrack(): MediaStreamTrack {
  return { kind: "audio", onended: null } as unknown as MediaStreamTrack;
}

function endTrack(track: MediaStreamTrack): void {
  (track.onended as unknown as () => void)();
}

let settings: VoiceSettings;
let peers: Map<string, Participant>;
let speech: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let changed: Mock<() => void>;
let forgetOutputDevice: Mock<() => void>;
let audio: RemoteAudio;

function addPeer(userId = "u-z"): Participant {
  const peer = createParticipant({
    user: { userId, displayName: "Ola", muted: false },
    preference: { ...DEFAULT_PARTICIPANT_PREFERENCE },
    createVoice: () => audio.createVoice(),
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
  audio = new RemoteAudio({
    people: peers,
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

describe("RemoteAudio shared-screen sound", () => {
  const announceScreen = (peer: Participant, streamId: string | null) =>
    peer.media.announce({ screenStreamId: streamId, cameraStreamId: null });

  function screenSinks(): HTMLAudioElement[] {
    return [...document.querySelectorAll<HTMLAudioElement>("[data-stellarr-voice-audio] audio")];
  }

  it("plays a share's sound on sinks of its own and leaves the voice alone", () => {
    const peer = addPeer();
    const voice = fakeStream();
    const share = fakeStream();
    announceScreen(peer, share.id);

    audio.receive(peer, voice, fakeTrack());
    audio.receive(peer, share, fakeTrack());

    expect(peer.voice.audio.srcObject).toBe(voice);
    expect(peer.screenAudio).toMatchObject({ streamId: share.id });
    expect(peer.screenAudio?.audio.srcObject).toBe(share);
    expect(changed).toHaveBeenCalled();
  });

  it("takes a stream off the voice sink once it is announced as a share", () => {
    const peer = addPeer();
    const share = fakeStream();
    audio.receive(peer, share, fakeTrack());
    expect(peer.voice.audio.srcObject).toBe(share);

    announceScreen(peer, share.id);
    audio.route(peer);

    expect(peer.voice).toMatchObject({ streamId: null, processed: false });
    expect(peer.voice.audio.srcObject).toBeNull();
    expect(screenSinks().filter((sink) => sink.srcObject === share)).toHaveLength(1);
    expect(speech.remove).toHaveBeenCalledWith("u-z");
  });

  it("keeps a voice on its sink when a camera joins its stream", () => {
    const peer = addPeer();
    const voice = fakeStream();
    audio.receive(peer, voice, fakeTrack());

    peer.media.addVideo(voice);
    audio.route(peer);

    expect(peer.voice.audio.srcObject).toBe(voice);
    expect(peer.screenAudio).toBeNull();
  });

  it("sends a share's sound through a strip that is never gated or denoised", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    peer.gated = true;
    peer.suppressed = true;
    const share = fakeStream();
    announceScreen(peer, share.id);

    audio.receive(peer, share, fakeTrack());

    expect(mixer.attach).toHaveBeenCalledOnce();
    expect(mixer.attach).toHaveBeenCalledWith("u-z", share, peer.screenAudio?.audio, 100, undefined);
    expect(speech.add).not.toHaveBeenCalled();
  });

  it("applies the participant volume to it, and only that volume", () => {
    const peer = addPeer();
    peer.playbackVolume = 40;
    const share = fakeStream();
    announceScreen(peer, share.id);
    audio.receive(peer, share, fakeTrack());

    peer.playbackVolume = 25;
    audio.applyVolume(peer);

    expect(peer.screenAudio?.audio.volume).toBeCloseTo(0.25);
  });

  it("hands the volume of a processed share to its strip", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    const share = fakeStream();
    announceScreen(peer, share.id);
    audio.receive(peer, share, fakeTrack());

    peer.playbackVolume = 80;
    audio.applyVolume(peer);

    expect(mixer.setVolume).toHaveBeenCalledWith("u-z", 80);
  });

  it("mutes it when deafened, including a share that starts afterwards", () => {
    const peer = addPeer();
    const first = fakeStream();
    announceScreen(peer, first.id);
    audio.receive(peer, first, fakeTrack());

    audio.setDeafened(true);
    expect(peer.screenAudio?.audio.muted).toBe(true);

    announceScreen(peer, null);
    audio.route(peer);
    const second = fakeStream();
    announceScreen(peer, second.id);
    audio.receive(peer, second, fakeTrack());
    expect(peer.screenAudio?.audio.muted).toBe(true);

    audio.setDeafened(false);
    expect(peer.screenAudio?.audio.muted).toBe(false);
  });

  it("removes only the share's sinks when the share is withdrawn", () => {
    const mixer = withWebAudio();
    const peer = addPeer();
    const voice = fakeStream();
    const share = fakeStream();
    announceScreen(peer, share.id);
    audio.receive(peer, voice, fakeTrack());
    audio.receive(peer, share, fakeTrack());
    const sinks = peer.screenAudio!;

    announceScreen(peer, null);
    audio.route(peer);

    expect(peer.screenAudio).toBeNull();
    expect(sinks.audio.isConnected).toBe(false);
    expect(sinks.decoder.isConnected).toBe(false);
    expect(peer.voice.streamId).toBe(voice.id);
    expect(mixer.remove).toHaveBeenCalledWith("u-z");
  });

  it("leaves the voice playing when only the share's audio track ends", () => {
    const peer = addPeer();
    const voice = fakeStream();
    const shareTrack = fakeTrack();
    const share = fakeStream();
    announceScreen(peer, share.id);
    audio.receive(peer, voice, fakeTrack());
    audio.receive(peer, share, shareTrack);

    endTrack(shareTrack);

    expect(peer.screenAudio).toBeNull();
    expect(peer.voice.audio.srcObject).toBe(voice);
  });

  it("moves the share's sinks to the chosen output device with the voice's", async () => {
    const setSinkId = vi.fn(async () => undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: setSinkId,
    });
    try {
      const peer = addPeer();
      const share = fakeStream();
      announceScreen(peer, share.id);
      audio.receive(peer, share, fakeTrack());
      settings = { ...settings, outputDeviceId: "usb-headphones" };
      setSinkId.mockClear();

      await audio.refreshOutput();

      expect(setSinkId).toHaveBeenCalledTimes(2);
    } finally {
      delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
  });

  it("frees the share's sinks and strip together with the peer", () => {
    const peer = addPeer();
    const share = fakeStream();
    announceScreen(peer, share.id);
    audio.receive(peer, share, fakeTrack());

    audio.release(peer);

    expect(screenSinks()).toHaveLength(0);
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

    // The voice mixer and the shared-screen mixer, then playback.
    expect(order).toEqual(["resume", "resume", "play"]);
  });

  it("forwards the playback profile to the mixer", () => {
    const setProfile = vi
      .spyOn(RemoteVoiceMixer.prototype, "setProfile")
      .mockImplementation(() => undefined);

    audio.setProfile("studio", settings.playbackTuning);

    expect(setProfile).toHaveBeenCalledWith("studio", settings.playbackTuning);
  });
});
