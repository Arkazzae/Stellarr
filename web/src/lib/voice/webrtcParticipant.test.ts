import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createParticipant,
  receiveRemoteState,
  receiveRemoteTrack,
  type Participant,
  type ParticipantMediaEnv,
} from "./webrtcParticipant";

function track(kind: "audio" | "video"): MediaStreamTrack {
  return { kind, onended: null } as unknown as MediaStreamTrack;
}

function stream(id: string, ...tracks: MediaStreamTrack[]): MediaStream {
  return {
    id,
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
  } as unknown as MediaStream;
}

function end(ended: MediaStreamTrack): void {
  (ended.onended as unknown as () => void)();
}

let receive: Mock<ParticipantMediaEnv["remoteAudio"]["receive"]>;
let route: Mock<ParticipantMediaEnv["remoteAudio"]["route"]>;
let changed: Mock<() => void>;
let env: ParticipantMediaEnv;
let createVoice: Mock<() => Participant["voice"]>;
let person: Participant;

beforeEach(() => {
  receive = vi.fn();
  route = vi.fn();
  changed = vi.fn();
  env = { remoteAudio: { receive, route }, changed };
  createVoice = vi.fn(() => ({
    audio: document.createElement("audio"),
    decoder: document.createElement("audio"),
    processed: false,
    streamId: null,
  }));
  person = createParticipant({
    user: { userId: "u-z", displayName: "Ola", muted: false },
    preference: { volume: 40, gated: true, suppressed: false },
    createVoice,
  });
});

describe("createParticipant", () => {
  it("starts from the snapshot and from how this account last heard the person", () => {
    expect(person).toMatchObject({
      userId: "u-z",
      displayName: "Ola",
      muted: false,
      speaking: false,
      level: 0,
      playbackVolume: 40,
      gated: true,
      suppressed: false,
      screenAudio: null,
    });
    expect(createVoice).toHaveBeenCalledOnce();
    expect(person.voice).toBe(createVoice.mock.results[0]?.value);
  });
});

describe("receiveRemoteTrack", () => {
  it("hands a sound to playback, which decides what it is", () => {
    const sound = track("audio");
    const media = stream("mic", sound);

    receiveRemoteTrack(env, person, sound, media);

    expect(receive).toHaveBeenCalledWith(person, media, sound, "mic");
    expect(changed).not.toHaveBeenCalled();
  });

  it("files a track under the id it is given rather than its stream's own", () => {
    const picture = track("video");
    const media = stream("msid-hint", picture);
    person.media.announce({ screenStreamId: null, cameraStreamId: "face-2" });

    receiveRemoteTrack(env, person, picture, media, "face-2");

    expect(person.media.camera).toEqual({ streamId: "face-2", stream: media });
    end(picture);
    expect(person.media.camera).toBeNull();
  });

  it("files a picture under the person, then places the sound again", () => {
    const picture = track("video");
    const media = stream("share", picture);
    person.media.announce({ screenStreamId: "share", cameraStreamId: null });

    receiveRemoteTrack(env, person, picture, media);

    expect(person.media.screen?.stream).toBe(media);
    expect(route).toHaveBeenCalledWith(person);
    expect(changed).toHaveBeenCalled();
  });

  it("re-places the sound only when an announced picture ends", () => {
    const announced = track("video");
    const unannounced = track("video");
    person.media.announce({ screenStreamId: "share", cameraStreamId: null });
    receiveRemoteTrack(env, person, announced, stream("share", announced));
    receiveRemoteTrack(env, person, unannounced, stream("other", unannounced));
    route.mockClear();
    changed.mockClear();

    end(unannounced);
    expect(route).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledOnce();

    end(announced);
    expect(route).toHaveBeenCalledWith(person);
    expect(person.media.screen).toBeNull();
  });
});

describe("receiveRemoteState", () => {
  it("takes the person's mute and their account of their streams", () => {
    receiveRemoteState(env, person, {
      muted: true,
      screenStreamId: "share",
      cameraStreamId: "face",
    });

    expect(person.muted).toBe(true);
    expect(person.media.roleOf("share")).toBe("screen");
    expect(route).toHaveBeenCalledWith(person);
    expect(changed).toHaveBeenCalled();
  });
});
