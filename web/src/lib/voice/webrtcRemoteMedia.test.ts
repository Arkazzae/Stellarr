import { beforeEach, describe, expect, it } from "vitest";

import { RemoteMedia } from "./webrtcRemoteMedia";

/** A stream; `audioTracks` is how many audio tracks it already holds when it is handed over. */
function stream(id: string, audioTracks = 0): MediaStream {
  return { id, getAudioTracks: () => new Array(audioTracks).fill({}) } as unknown as MediaStream;
}

const NO_ANNOUNCEMENT = { screenStreamId: null, cameraStreamId: null };

function sdpWithVideoOn(streamId: string): string {
  return [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=mid:0",
    "a=msid:mic-stream mic-track",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=mid:1",
    `a=msid:${streamId} video-track`,
    "",
  ].join("\r\n");
}

let media: RemoteMedia;

beforeEach(() => {
  media = new RemoteMedia();
});

describe("telling a microphone from a share's sound", () => {
  it("takes a stream nobody has said anything about for a microphone", () => {
    expect(media.roleOf("unknown")).toBe("microphone");
  });

  it("recognises the sound of a share by the video on the same stream", () => {
    media.addAudio(stream("share"));
    expect(media.roleOf("share")).toBe("microphone");

    media.addVideo(stream("share"));

    expect(media.roleOf("share")).toBe("screen");
  });

  it("recognises it from the remote description before any track exists", () => {
    media.learnFromSdp(sdpWithVideoOn("share"));

    expect(media.roleOf("share")).toBe("screen");
    expect(media.roleOf("mic-stream")).toBe("microphone");
  });

  it("recognises it from the person's announcement before any track exists", () => {
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    expect(media.roleOf("share")).toBe("screen");
  });

  it("never takes the announced camera for a share, whatever else points that way", () => {
    media.addVideo(stream("cam"));
    media.announce({ screenStreamId: null, cameraStreamId: "cam" });

    expect(media.roleOf("cam")).toBe("microphone");
  });

  it("stops counting a video as evidence once it has ended", () => {
    media.addAudio(stream("share"));
    media.addVideo(stream("share"));

    media.removeVideo("share");

    expect(media.roleOf("share")).toBe("microphone");
  });

  it("gets the evidence back from a later remote description", () => {
    media.addVideo(stream("share"));
    media.removeVideo("share");

    media.learnFromSdp(sdpWithVideoOn("share"));

    expect(media.roleOf("share")).toBe("screen");
  });

  it("tolerates a missing description", () => {
    media.learnFromSdp(null);
    media.learnFromSdp(undefined);

    expect(media.roleOf("anything")).toBe("microphone");
  });
});

describe("audio streams", () => {
  it("offers the newest stream of each role", () => {
    media.addAudio(stream("old-mic"));
    media.addAudio(stream("share"));
    media.addAudio(stream("new-mic"));
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    expect(media.newestAudio("microphone")?.id).toBe("new-mic");
    expect(media.newestAudio("screen")?.id).toBe("share");
  });

  it("offers nothing for a role that has no stream", () => {
    media.addAudio(stream("mic"));

    expect(media.newestAudio("screen")).toBeNull();
  });

  it("moves a stream between roles as soon as evidence arrives", () => {
    media.addAudio(stream("a"));
    media.addAudio(stream("b"));
    expect(media.newestAudio("microphone")?.id).toBe("b");

    media.announce({ screenStreamId: "b", cameraStreamId: null });

    expect(media.newestAudio("microphone")?.id).toBe("a");
    expect(media.newestAudio("screen")?.id).toBe("b");
  });

  it("says whether a removed stream was known, so a late end event does nothing", () => {
    media.addAudio(stream("mic"));

    expect(media.hasAudio("mic")).toBe(true);
    expect(media.removeAudio("mic")).toBe(true);
    expect(media.removeAudio("mic")).toBe(false);
    expect(media.hasAudio("mic")).toBe(false);
  });
});

describe("the share and camera shown to the UI", () => {
  it("shows nothing for an announcement whose video has not arrived", () => {
    media.announce({ screenStreamId: "share", cameraStreamId: "cam" });

    expect(media.screen).toBeNull();
    expect(media.camera).toBeNull();
  });

  it("shows a share once both the announcement and the video are in, in either order", () => {
    const share = stream("share");
    media.addVideo(share);
    expect(media.screen).toBeNull();

    media.announce({ screenStreamId: "share", cameraStreamId: null });

    expect(media.screen).toEqual({ streamId: "share", hasAudio: false, stream: share });
  });

  it("does not show video nobody announced", () => {
    media.addVideo(stream("cam"));

    expect(media.screen).toBeNull();
    expect(media.camera).toBeNull();
  });

  it("reports a share's sound for as long as that audio stream lives", () => {
    media.addVideo(stream("share"));
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    media.addAudio(stream("share"));
    expect(media.screen?.hasAudio).toBe(true);

    media.removeAudio("share");
    expect(media.screen).toMatchObject({ streamId: "share", hasAudio: false });
  });

  it("reports the sound already on the share's stream before its audio track is announced", () => {
    media.addVideo(stream("share", 1));
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    expect(media.screen?.hasAudio).toBe(true);

    media.removeAudio("share");
    expect(media.screen?.hasAudio).toBe(false);
  });

  it("shows the camera without any sound", () => {
    const camera = stream("cam");
    media.addVideo(camera);
    media.announce({ screenStreamId: null, cameraStreamId: "cam" });

    expect(media.camera).toEqual({ streamId: "cam", stream: camera });
    expect(media.screen).toBeNull();
  });
});

describe("a share or camera that ends", () => {
  it("says whether an announced share or camera ended with the video", () => {
    media.addVideo(stream("share"));
    media.addVideo(stream("cam"));
    media.addVideo(stream("other"));
    media.announce({ screenStreamId: "share", cameraStreamId: "cam" });

    expect(media.removeVideo("other")).toBe(false);
    expect(media.removeVideo("share")).toBe(true);
    expect(media.removeVideo("cam")).toBe(true);
  });

  it("takes an announced share and its sound with it when the video ends", () => {
    media.addVideo(stream("share"));
    media.addAudio(stream("share"));
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    media.removeVideo("share");

    expect(media.screen).toBeNull();
    expect(media.hasAudio("share")).toBe(false);
  });

  it("forgets a withdrawn share completely, so its id cannot come back", () => {
    media.addVideo(stream("share"));
    media.addAudio(stream("share"));
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    media.announce(NO_ANNOUNCEMENT);

    expect(media.screen).toBeNull();
    expect(media.hasAudio("share")).toBe(false);
    expect(media.roleOf("share")).toBe("microphone");
  });

  it("does not hand a stale camera stream to a later screen role", () => {
    media.addVideo(stream("reused"));
    media.announce({ screenStreamId: null, cameraStreamId: "reused" });
    expect(media.camera).not.toBeNull();

    media.announce(NO_ANNOUNCEMENT);
    media.announce({ screenStreamId: "reused", cameraStreamId: null });

    expect(media.camera).toBeNull();
    expect(media.screen).toBeNull();
  });

  it("keeps everything when the same announcement is repeated", () => {
    const share = stream("share");
    media.addVideo(share);
    media.announce({ screenStreamId: "share", cameraStreamId: null });

    media.announce({ screenStreamId: "share", cameraStreamId: null });

    expect(media.screen?.stream).toBe(share);
  });

  it("leaves an announced camera alone when only the share changes", () => {
    media.addVideo(stream("cam"));
    media.addVideo(stream("share"));
    media.announce({ screenStreamId: "share", cameraStreamId: "cam" });

    media.announce({ screenStreamId: null, cameraStreamId: "cam" });

    expect(media.camera).not.toBeNull();
    expect(media.screen).toBeNull();
  });
});
