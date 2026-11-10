import { describe, expect, it } from "vitest";
import { tuneLocalDescription, tuneOpusSdp, videoStreamIds } from "./sdp";

function sdpOf(...lines: string[]): string {
  return [...lines, ""].join("\r\n");
}

describe("videoStreamIds", () => {
  it("reads the unified-plan msid line of a video section", () => {
    const sdp = sdpOf(
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=msid:mic mic-track",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=msid:screen-1 video-track",
    );
    expect([...videoStreamIds(sdp)]).toEqual(["screen-1"]);
  });

  it("reads the older per-ssrc spelling", () => {
    const sdp = sdpOf(
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=ssrc:1234 cname:abc",
      "a=ssrc:1234 msid:screen-2 video-track",
    );
    expect([...videoStreamIds(sdp)]).toEqual(["screen-2"]);
  });

  it("collects the streams of every video section", () => {
    const sdp = sdpOf(
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=msid:camera cam-track",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=msid:screen screen-track",
    );
    expect(videoStreamIds(sdp)).toEqual(new Set(["camera", "screen"]));
  });

  it("ignores the placeholder that means a section has no stream", () => {
    const sdp = sdpOf(
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=msid:- video-track",
      "a=ssrc:1234 msid:- video-track",
    );
    expect(videoStreamIds(sdp).size).toBe(0);
  });

  it("does not attribute audio-only streams to video", () => {
    const sdp = sdpOf(
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=msid:mic mic-track",
    );
    expect(videoStreamIds(sdp).size).toBe(0);
  });

  it("yields nothing for missing or empty input", () => {
    expect(videoStreamIds(undefined).size).toBe(0);
    expect(videoStreamIds(null).size).toBe(0);
    expect(videoStreamIds("").size).toBe(0);
  });

  it("copes with LF-only line endings", () => {
    const sdp = "v=0\nm=video 9 UDP/TLS/RTP/SAVPF 96\na=msid:lf-stream track\n";
    expect([...videoStreamIds(sdp)]).toEqual(["lf-stream"]);
  });
});

describe("tuneLocalDescription without an sdp", () => {
  it("hands a rollback description back untouched", () => {
    const rollback: RTCSessionDescriptionInit = { type: "rollback" };
    expect(tuneLocalDescription(rollback)).toBe(rollback);
  });
});

describe("tuneOpusSdp with unusual rtpmap spacing", () => {
  it("never places a created fmtp line above the m-line", () => {
    const sdp = sdpOf(
      "v=0",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111\topus/48000/2",
    );

    const lines = tuneOpusSdp(sdp).split("\r\n");

    expect(lines.indexOf("m=audio 9 UDP/TLS/RTP/SAVPF 111")).toBe(2);
    expect(lines.slice(0, 2)).toEqual(["v=0", "t=0 0"]);
  });
});
