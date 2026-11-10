import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";
import { VoiceStateStore } from "./store";
import { LocalCamera, LocalScreen, type LocalCameraEnv } from "./webrtcLocalVideo";
import type { Peer } from "./webrtcPeer";

function track(kind: "audio" | "video", channelCount = 2): MediaStreamTrack {
  return {
    kind,
    contentHint: "",
    onended: null,
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => undefined),
    getSettings: () => ({ channelCount }),
  } as unknown as MediaStreamTrack;
}

let streamCounter = 0;
function stream(...tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `stream-${streamCounter++}`,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((item) => item.kind === "video"),
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
  } as unknown as MediaStream;
}

class FakeSender {
  parameters = { encodings: [{}] } as unknown as RTCRtpSendParameters;
  constructor(public track: MediaStreamTrack) {}
  replaceTrack = vi.fn(async (next: MediaStreamTrack | null) => {
    if (next) this.track = next;
  });
  setStreams = vi.fn();
  getParameters = vi.fn(() => this.parameters);
  setParameters = vi.fn(async (next: RTCRtpSendParameters) => {
    this.parameters = next;
  });
}

class FakeConnection {
  senders: FakeSender[] = [];
  removed: FakeSender[] = [];
  addTrack = vi.fn((media: MediaStreamTrack) => {
    const sender = new FakeSender(media);
    this.senders.push(sender);
    return sender;
  });
  removeTrack = vi.fn((sender: FakeSender) => {
    this.removed.push(sender);
  });
  getTransceivers = () =>
    this.senders.map((sender) => ({ sender, mid: null, setCodecPreferences: vi.fn() }));
}

function peer(id: string): Peer {
  return {
    userId: id,
    connection: new FakeConnection(),
    cameraSender: null,
    screenVideoSender: null,
    screenAudioSender: null,
  } as unknown as Peer;
}

const connectionOf = (item: Peer) => item.connection as unknown as FakeConnection;
const senderOf = (sender: RTCRtpSender | null) => sender as unknown as FakeSender;

let store: VoiceStateStore;
let peers: Map<string, Peer>;
let settings: VoiceSettings;
let session: number | null;
let publish: Mock<() => void>;
let announce: Mock<() => void>;
let renegotiate: Mock<() => Promise<void>>;
let useSystemCamera: Mock<() => VoiceSettings>;
let recaptureCamera: Mock<(settings: VoiceSettings) => Promise<void>>;
let getUserMedia: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>;
let getDisplayMedia: Mock<() => Promise<MediaStream>>;
let camera: LocalCamera;
let screen: LocalScreen;

beforeEach(() => {
  store = new VoiceStateStore();
  store.set({ cameraSupported: true });
  peers = new Map();
  settings = { ...DEFAULT_SETTINGS };
  session = 1;
  publish = vi.fn<() => void>();
  announce = vi.fn<() => void>();
  renegotiate = vi.fn<() => Promise<void>>(async () => undefined);
  useSystemCamera = vi.fn<() => VoiceSettings>(() => {
    settings = { ...settings, videoDeviceId: null };
    return settings;
  });
  recaptureCamera = vi.fn<(next: VoiceSettings) => Promise<void>>(async () => undefined);
  getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
  getDisplayMedia = vi.fn<() => Promise<MediaStream>>();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, getDisplayMedia } });

  const env: LocalCameraEnv = {
    store,
    peers,
    settings: () => settings,
    session: () => session,
    isStale: (candidate) => candidate !== session,
    publish,
    announce,
    renegotiate,
    useSystemCamera,
    recaptureCamera,
  };
  camera = new LocalCamera(env);
  screen = new LocalScreen(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function addPeer(id = "u-z"): Peer {
  const added = peer(id);
  peers.set(id, added);
  return added;
}

/** Make the next camera the browser hands out, and return its video track. */
function nextCamera(): { video: MediaStreamTrack; media: MediaStream } {
  const video = track("video");
  const media = stream(video);
  getUserMedia.mockResolvedValueOnce(media);
  return { video, media };
}

describe("LocalCamera.start", () => {
  it("sends the camera to everyone already in the call and shows it as the local camera", async () => {
    const first = addPeer("u-y");
    const second = addPeer("u-z");
    const { video, media } = nextCamera();

    await camera.start();

    for (const item of [first, second]) {
      expect(senderOf(item.cameraSender).track).toBe(video);
    }
    expect(store.getSnapshot()).toMatchObject({
      cameraPending: false,
      localCamera: { streamId: media.id, stream: media },
    });
    expect(camera.streamId).toBe(media.id);
    expect(announce).toHaveBeenCalledOnce();
  });

  it.each([
    ["no call is joined", () => (session = null)],
    ["the browser has no camera", () => store.set({ cameraSupported: false })],
    ["a camera is already being opened", () => store.set({ cameraPending: true })],
  ])("does nothing when %s", async (_name, arrange) => {
    arrange();

    await camera.start();

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("does nothing while the camera is already on", async () => {
    nextCamera();
    await camera.start();

    await camera.start();

    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("opens the system camera once when the remembered one is gone, and remembers that", async () => {
    settings = { ...settings, videoDeviceId: "unplugged" };
    getUserMedia.mockRejectedValueOnce(new DOMException("gone", "NotFoundError"));
    nextCamera();

    await camera.start();

    expect(useSystemCamera).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({ facingMode: "user" }),
    });
    expect(store.getSnapshot().localCamera).not.toBeNull();
  });

  it("does not try another camera after a refusal, which no second prompt can repair", async () => {
    settings = { ...settings, videoDeviceId: "some-camera" };
    getUserMedia.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));

    await camera.start();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(useSystemCamera).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      cameraPending: false,
      localCamera: null,
      error: { kind: "camera", recoverable: true },
    });
  });

  it("reports a system camera that cannot be opened either", async () => {
    settings = { ...settings, videoDeviceId: "unplugged" };
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"));

    await camera.start();

    expect(store.getSnapshot()).toMatchObject({
      cameraPending: false,
      error: { kind: "camera" },
    });
  });

  it("lets go of a camera that opened after the call was left", async () => {
    const opening = nextCamera();
    const added = addPeer();
    const started = camera.start();
    session = 2;
    await started;

    expect(opening.video.stop).toHaveBeenCalled();
    expect(added.cameraSender).toBeNull();
    expect(camera.streamId).toBeNull();
  });
});

describe("LocalCamera.stop and release", () => {
  it("takes the camera off every connection, releases the device and offers again", async () => {
    const added = addPeer();
    const { video } = nextCamera();
    await camera.start();
    announce.mockClear();

    await camera.stop();
    await camera.stop();

    expect(connectionOf(added).removeTrack).toHaveBeenCalledOnce();
    expect(added.cameraSender).toBeNull();
    expect(video.stop).toHaveBeenCalled();
    expect(store.getSnapshot().localCamera).toBeNull();
    expect(announce).toHaveBeenCalledOnce();
    expect(renegotiate).toHaveBeenCalledOnce();
  });

  it("only releases the device when the call goes away", async () => {
    const added = addPeer();
    const { video } = nextCamera();
    await camera.start();

    camera.release();

    expect(video.stop).toHaveBeenCalled();
    expect(connectionOf(added).removeTrack).not.toHaveBeenCalled();
    expect(renegotiate).not.toHaveBeenCalled();
    expect(camera.streamId).toBeNull();
  });

  it("gives a connection made later the camera that is on", async () => {
    nextCamera();
    await camera.start();
    const late = peer("u-late");

    camera.addTo(late);
    camera.addTo(late);

    expect(connectionOf(late).addTrack).toHaveBeenCalledOnce();
  });

  it("caps the camera encoder at the chosen quality", async () => {
    settings = { ...settings, cameraQuality: "economy" };
    const added = addPeer();
    nextCamera();

    await camera.start();

    expect(senderOf(added.cameraSender).parameters).toMatchObject({
      encodings: [{ maxBitrate: 700_000, maxFramerate: 24 }],
      degradationPreference: "maintain-framerate",
    });
  });
});

describe("LocalCamera.follow", () => {
  async function startWithPeers() {
    const added = [addPeer("u-y"), addPeer("u-z")];
    const first = nextCamera();
    await camera.start();
    getUserMedia.mockClear();
    announce.mockClear();
    return { added, first };
  }

  it("leaves the camera alone when neither device nor quality changed", async () => {
    await startWithPeers();

    await camera.follow(settings, { ...settings, outputVolume: 10 }, false);

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("does nothing without a camera, even when asked to reopen it", async () => {
    await camera.follow(settings, settings, true);

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("moves every connection to the new picture, then releases the old device", async () => {
    const { added, first } = await startWithPeers();
    const second = nextCamera();
    settings = { ...settings, videoDeviceId: "camera-2" };

    await camera.follow(DEFAULT_SETTINGS, settings, false);

    for (const item of added) {
      expect(senderOf(item.cameraSender).replaceTrack).toHaveBeenCalledWith(second.video);
      expect(senderOf(item.cameraSender).setStreams).toHaveBeenCalledWith(second.media);
    }
    expect(first.video.stop).toHaveBeenCalled();
    expect(second.video.stop).not.toHaveBeenCalled();
    expect(store.getSnapshot().localCamera?.streamId).toBe(second.media.id);
    expect(announce).toHaveBeenCalledOnce();
    expect(renegotiate).toHaveBeenCalledOnce();
  });

  it("reopens the same camera when asked to, as after the system default moved", async () => {
    await startWithPeers();
    const second = nextCamera();

    await camera.follow(settings, settings, true);

    expect(store.getSnapshot().localCamera?.streamId).toBe(second.media.id);
  });

  it("puts everyone back on the old picture when one connection refuses the new one", async () => {
    const { added, first } = await startWithPeers();
    const second = nextCamera();
    senderOf(added[1]!.cameraSender).replaceTrack.mockRejectedValueOnce(new Error("closed"));

    await camera.follow(settings, settings, true);

    expect(senderOf(added[0]!.cameraSender).replaceTrack).toHaveBeenLastCalledWith(first.video);
    expect(second.video.stop).toHaveBeenCalled();
    expect(first.video.stop).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      localCamera: { streamId: first.media.id },
      error: { kind: "camera", recoverable: true },
    });
    expect(renegotiate).not.toHaveBeenCalled();
  });

  it("keeps the old camera and says so when the new one cannot be opened", async () => {
    const { first } = await startWithPeers();
    getUserMedia.mockRejectedValueOnce(new DOMException("busy", "NotReadableError"));

    await camera.follow(settings, settings, true);

    expect(first.video.stop).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      localCamera: { streamId: first.media.id },
      error: { kind: "camera" },
    });
  });

  it("drops a new camera that arrived after the old one was switched off", async () => {
    await startWithPeers();
    const second = nextCamera();

    const following = camera.follow(settings, settings, true);
    await camera.stop();
    await following;

    expect(second.video.stop).toHaveBeenCalled();
    expect(camera.streamId).toBeNull();
  });

  it("clears an earlier camera error once the swap worked, and only that", async () => {
    await startWithPeers();
    nextCamera();
    store.set({ error: { kind: "camera", message: "earlier" } });

    await camera.follow(settings, settings, true);
    expect(store.getSnapshot().error).toBeNull();

    nextCamera();
    store.set({ error: { kind: "signaling", message: "unrelated" } });
    await camera.follow(settings, settings, true);
    expect(store.getSnapshot().error?.kind).toBe("signaling");
  });
});

describe("a camera that is unplugged during the call", () => {
  async function unplugged() {
    const added = addPeer();
    const lost = nextCamera();
    await camera.start();
    return { added, lost, end: lost.video.onended as unknown as () => void };
  }

  it("switches to the system camera when there is one", async () => {
    const { lost, end } = await unplugged();
    const fallback = nextCamera();
    recaptureCamera.mockImplementationOnce(async (next: VoiceSettings) => {
      await camera.follow(settings, next, true);
    });

    end();
    await vi.waitFor(() => expect(store.getSnapshot().localCamera?.streamId).toBe(fallback.media.id));

    expect(useSystemCamera).toHaveBeenCalledOnce();
    expect(recaptureCamera).toHaveBeenCalledWith(expect.objectContaining({ videoDeviceId: null }));
    expect(store.getSnapshot().error).toBeNull();
    expect(lost.video.stop).toHaveBeenCalled();
  });

  it("stops publishing, and says why, when no camera is left", async () => {
    const { added, end } = await unplugged();

    end();
    await vi.waitFor(() => expect(store.getSnapshot().localCamera).toBeNull());

    expect(connectionOf(added).removeTrack).toHaveBeenCalledOnce();
    expect(store.getSnapshot().error).toMatchObject({ kind: "camera", recoverable: true });
    expect(renegotiate).toHaveBeenCalled();
  });

  it("ignores the loss when the call was left meanwhile", async () => {
    const { end } = await unplugged();
    session = 2;

    end();
    await vi.waitFor(() => expect(recaptureCamera).toHaveBeenCalled());
    await Promise.resolve();

    expect(store.getSnapshot().error).toBeNull();
  });
});

describe("LocalScreen", () => {
  function pickScreen(withSound = false) {
    const video = track("video");
    const audio = withSound ? track("audio") : null;
    const media = stream(...(audio ? [video, audio] : [video]));
    getDisplayMedia.mockResolvedValueOnce(media);
    return { video, audio, media };
  }

  it("shares the picture, and the sound when the picker gave one, with everyone in the call", async () => {
    const added = addPeer();
    const { video, audio, media } = pickScreen(true);

    await screen.start();

    expect(senderOf(added.screenVideoSender).track).toBe(video);
    expect(senderOf(added.screenAudioSender).track).toBe(audio);
    expect(store.getSnapshot().localScreen).toEqual({
      streamId: media.id,
      hasAudio: true,
      stream: media,
    });
    expect(announce).toHaveBeenCalledOnce();
  });

  it("does not open a second picker while a share is running", async () => {
    pickScreen();
    await screen.start();
    await screen.start();

    expect(getDisplayMedia).toHaveBeenCalledOnce();
  });

  it("does nothing outside a call", async () => {
    session = null;

    await screen.start();

    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(store.getSnapshot().screenSharePending).toBe(false);
  });

  it("stops the capture of a share that was picked after the call was left", async () => {
    const picked = pickScreen(true);
    const added = addPeer();
    const starting = screen.start();
    session = 2;
    await starting;

    expect(picked.video.stop).toHaveBeenCalled();
    expect(picked.audio?.stop).toHaveBeenCalled();
    expect(added.screenVideoSender).toBeNull();
    expect(screen.streamId).toBeNull();
  });

  it("stops once and offers again when the share ends, whoever ended it", async () => {
    const added = addPeer();
    const { video } = pickScreen(true);
    await screen.start();
    const end = video.onended as unknown as () => void;

    end();
    end();
    await screen.stop();

    expect(connectionOf(added).removeTrack).toHaveBeenCalledTimes(2);
    expect(added.screenVideoSender).toBeNull();
    expect(added.screenAudioSender).toBeNull();
    expect(video.stop).toHaveBeenCalled();
    expect(store.getSnapshot().localScreen).toBeNull();
    expect(renegotiate).toHaveBeenCalledOnce();
  });

  it("keeps the picture when only the sound ends", async () => {
    const added = addPeer();
    const { video, audio, media } = pickScreen(true);
    await screen.start();
    const audioSender = added.screenAudioSender;

    (audio?.onended as unknown as () => void)();
    await vi.waitFor(() => expect(store.getSnapshot().localScreen?.hasAudio).toBe(false));

    expect(connectionOf(added).removed).toEqual([audioSender]);
    expect(added.screenVideoSender).not.toBeNull();
    expect(video.stop).not.toHaveBeenCalled();
    expect(store.getSnapshot().localScreen?.stream).toBe(media);
    expect(renegotiate).toHaveBeenCalledOnce();
    // The share keeps its stream id, so the state frame has nothing new to say.
    expect(publish).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledOnce();
  });

  it("only stops the capture when the call goes away", async () => {
    const added = addPeer();
    const { video, audio } = pickScreen(true);
    await screen.start();

    screen.release();

    expect(video.stop).toHaveBeenCalled();
    expect(audio?.stop).toHaveBeenCalled();
    expect(connectionOf(added).removeTrack).not.toHaveBeenCalled();
    expect(renegotiate).not.toHaveBeenCalled();
  });

  it("encodes shared sound as stereo only when the source has two channels", async () => {
    expect(screen.stereo).toBe(true);

    getDisplayMedia.mockResolvedValueOnce(stream(track("video"), track("audio", 1)));
    await screen.start();
    expect(screen.stereo).toBe(false);

    await screen.stop();
    getDisplayMedia.mockResolvedValueOnce(stream(track("video"), track("audio", 2)));
    await screen.start();
    expect(screen.stereo).toBe(true);
  });

  describe("changing the quality of a running share", () => {
    async function sharing() {
      const added = addPeer();
      const picked = pickScreen();
      await screen.start();
      return { added, ...picked };
    }

    it("says so when the browser kept the old capture settings", async () => {
      const { video } = await sharing();
      (video.applyConstraints as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("overconstrained"),
      );

      await screen.applyQuality("sharp");

      expect(store.getSnapshot().error).toMatchObject({ kind: "screen-share", recoverable: true });
    });

    it("says so when a connection refused the new encoder settings, even without the fallback", async () => {
      const { added } = await sharing();
      senderOf(added.screenVideoSender).setParameters.mockRejectedValue(new Error("no"));

      await screen.applyQuality("ultra");

      expect(store.getSnapshot().error).toMatchObject({ kind: "screen-share" });
    });

    it("withdraws that message once a later change went through", async () => {
      const { video } = await sharing();
      (video.applyConstraints as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("x"));
      await screen.applyQuality("sharp");
      expect(store.getSnapshot().error).not.toBeNull();

      await screen.applyQuality("economy");

      expect(store.getSnapshot().error).toBeNull();
    });

    it("leaves unrelated errors alone", async () => {
      await sharing();
      store.set({ error: { kind: "signaling", message: "hub" } });

      await screen.applyQuality("economy");

      expect(store.getSnapshot().error?.kind).toBe("signaling");
    });

    it("does nothing without a share", async () => {
      await screen.applyQuality("sharp");

      expect(store.getSnapshot().error).toBeNull();
    });
  });
});
