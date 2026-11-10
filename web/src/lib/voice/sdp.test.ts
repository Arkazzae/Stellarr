import { describe, expect, it } from "vitest";
import { AUDIO_PROFILES, opusParameters } from "./audioProfiles";
import {
  OPUS_FMTP_PARAMETERS,
  OPUS_PTIME,
  OPUS_TARGET_BITRATE,
  mergeFmtpParameters,
  opusFirstCodecList,
  mediaSections,
  preferOpusInSdp,
  screenVideoCodecList,
  tuneAudioSections,
  tuneLocalDescription,
  tuneOpusSdp,
} from "./sdp";

/** A Chrome-shaped audio offer, trimmed to the lines that matter. */
const CHROME_AUDIO = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "a=rtpmap:9 G722/8000",
  "a=rtpmap:0 PCMU/8000",
  "a=rtpmap:8 PCMA/8000",
  "a=rtpmap:13 CN/8000",
  "a=rtpmap:110 telephone-event/48000",
  "a=rtpmap:126 telephone-event/8000",
  "",
].join("\r\n");

function audioLines(sdp: string): string[] {
  return sdp.split(/\r\n|\n/);
}

function fmtpFor(sdp: string, pt: string): string {
  const line = audioLines(sdp).find((l) => l.startsWith(`a=fmtp:${pt} `));
  return line?.slice(`a=fmtp:${pt} `.length) ?? "";
}

function fmtpMap(sdp: string, pt: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of fmtpFor(sdp, pt).split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    out[eq === -1 ? part : part.slice(0, eq)] = eq === -1 ? "" : part.slice(eq + 1);
  }
  return out;
}

describe("mergeFmtpParameters", () => {
  it("keeps existing keys in place and overwrites their values", () => {
    expect(mergeFmtpParameters("minptime=10;useinbandfec=0", { useinbandfec: "1" })).toBe(
      "minptime=10;useinbandfec=1",
    );
  });

  it("appends keys that were not there", () => {
    expect(mergeFmtpParameters("minptime=10", { usedtx: "1" })).toBe(
      "minptime=10;usedtx=1",
    );
  });

  it("preserves parameters the browser added that we know nothing about", () => {
    const merged = mergeFmtpParameters("sprop-maxcapturerate=16000;cbr=1", {
      usedtx: "1",
    });
    expect(merged).toBe("sprop-maxcapturerate=16000;cbr=1;usedtx=1");
  });

  it("survives an empty list and stray whitespace", () => {
    expect(mergeFmtpParameters("", { stereo: "0" })).toBe("stereo=0");
    expect(mergeFmtpParameters(" minptime=10 ; usedtx=0 ", { usedtx: "1" })).toBe(
      "minptime=10;usedtx=1",
    );
  });

  it("keeps valueless flags as bare flags", () => {
    expect(mergeFmtpParameters("cbr", { usedtx: "1" })).toBe("cbr;usedtx=1");
  });
});

describe("tuneOpusSdp", () => {
  it("sets every parameter the product needs on the Opus payload type", () => {
    const tuned = tuneOpusSdp(CHROME_AUDIO);
    expect(fmtpMap(tuned, "111")).toMatchObject({
      useinbandfec: "1",
      usedtx: "0",
      maxaveragebitrate: String(OPUS_TARGET_BITRATE),
      stereo: "0",
      "sprop-stereo": "0",
      minptime: "10",
    });
  });

  it("targets 128 kbps continuous mono, matching the Premium sender cap", () => {
    expect(OPUS_FMTP_PARAMETERS["maxaveragebitrate"]).toBe("128000");
    expect(OPUS_TARGET_BITRATE).toBe(128000);
    expect(OPUS_FMTP_PARAMETERS["usedtx"]).toBe("0");
    expect(OPUS_FMTP_PARAMETERS["stereo"]).toBe("0");
  });

  it("adds a=ptime:20 once", () => {
    const tuned = tuneOpusSdp(CHROME_AUDIO);
    const ptimes = audioLines(tuned).filter((line) => line.startsWith("a=ptime:"));
    expect(ptimes).toEqual([`a=ptime:${OPUS_PTIME}`]);
  });

  it("replaces an existing ptime rather than adding a second", () => {
    const withPtime = CHROME_AUDIO.replace(
      "a=rtpmap:63 red/48000/2",
      "a=ptime:60\r\na=rtpmap:63 red/48000/2",
    );
    const ptimes = audioLines(tuneOpusSdp(withPtime)).filter((line) =>
      line.startsWith("a=ptime:"),
    );
    expect(ptimes).toEqual(["a=ptime:20"]);
  });

  it("does not touch the red or telephone-event fmtp lines", () => {
    const tuned = tuneOpusSdp(CHROME_AUDIO);
    expect(fmtpFor(tuned, "63")).toBe("111/111");
  });

  it("is idempotent — re-tuning a tuned SDP changes nothing", () => {
    const once = tuneOpusSdp(CHROME_AUDIO);
    expect(tuneOpusSdp(once)).toBe(once);
  });

  it("creates an fmtp line when the browser emitted none", () => {
    const bare = CHROME_AUDIO.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", "");
    const tuned = tuneOpusSdp(bare);
    expect(fmtpMap(tuned, "111")).toMatchObject({ usedtx: "0", minptime: "10" });
    // Inserted immediately after its rtpmap, where a parser expects it.
    const lines = audioLines(tuned);
    expect(lines[lines.indexOf("a=rtpmap:111 opus/48000/2") + 1]).toMatch(
      /^a=fmtp:111 /,
    );
  });

  it("preserves CRLF line endings and the trailing blank line", () => {
    const tuned = tuneOpusSdp(CHROME_AUDIO);
    expect(tuned.includes("\r\n")).toBe(true);
    expect(tuned.endsWith("\r\n")).toBe(true);
    expect(tuned).not.toMatch(/[^\r]\n/);
  });

  it("handles LF-only SDP without introducing CRLF", () => {
    const lf = CHROME_AUDIO.replace(/\r\n/g, "\n");
    const tuned = tuneOpusSdp(lf);
    expect(tuned.includes("\r")).toBe(false);
    expect(fmtpMap(tuned, "111")["usedtx"]).toBe("0");
  });

  it("only touches the audio section of a bundled offer", () => {
    const withVideo = [
      CHROME_AUDIO.trimEnd(),
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=rtpmap:96 VP8/90000",
      "a=fmtp:96 x-google-start-bitrate=800",
      "",
    ].join("\r\n");
    const tuned = tuneOpusSdp(withVideo);
    expect(fmtpFor(tuned, "96")).toBe("x-google-start-bitrate=800");
    expect(audioLines(tuned).filter((l) => l.startsWith("a=ptime:"))).toHaveLength(1);
  });

  it("returns SDP with no Opus untouched", () => {
    const noOpus = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 8",
      "a=rtpmap:8 PCMA/8000",
      "",
    ].join("\r\n");
    expect(tuneOpusSdp(noOpus)).toBe(noOpus);
  });

  it("returns SDP with no audio section untouched", () => {
    const videoOnly = ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 96", ""].join("\r\n");
    expect(tuneOpusSdp(videoOnly)).toBe(videoOnly);
  });

  it("degrades safely on empty or missing input", () => {
    expect(tuneOpusSdp("")).toBe("");
    expect(tuneOpusSdp(undefined)).toBe("");
    expect(tuneOpusSdp(null)).toBe("");
  });

  it("tunes every Opus payload type when a stack offers more than one", () => {
    const dual = CHROME_AUDIO.replace(
      "a=rtpmap:9 G722/8000",
      "a=rtpmap:112 opus/48000/2\r\na=rtpmap:9 G722/8000",
    );
    const tuned = tuneOpusSdp(dual);
    expect(fmtpMap(tuned, "111")["usedtx"]).toBe("0");
    expect(fmtpMap(tuned, "112")["usedtx"]).toBe("0");
  });
});

describe("preferOpusInSdp", () => {
  it("moves Opus to the front of the payload list without dropping anything", () => {
    const reordered = preferOpusInSdp(
      CHROME_AUDIO.replace(
        "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126",
        "m=audio 9 UDP/TLS/RTP/SAVPF 0 8 111 13",
      ),
    );
    const mLine = audioLines(reordered).find((line) => line.startsWith("m=audio"));
    expect(mLine).toBe("m=audio 9 UDP/TLS/RTP/SAVPF 111 0 8 13");
  });

  it("leaves an m-line that already leads with Opus alone", () => {
    expect(preferOpusInSdp(CHROME_AUDIO)).toBe(CHROME_AUDIO);
  });

  it("degrades safely when there is no Opus or no audio", () => {
    const noOpus = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 8", "a=rtpmap:8 PCMA/8000", ""].join(
      "\r\n",
    );
    expect(preferOpusInSdp(noOpus)).toBe(noOpus);
    expect(preferOpusInSdp("")).toBe("");
  });
});

describe("tuneLocalDescription", () => {
  it("returns a new description carrying the tuned SDP", () => {
    const description = { type: "offer" as const, sdp: CHROME_AUDIO };
    const tuned = tuneLocalDescription(description);
    expect(tuned.type).toBe("offer");
    expect(tuned.sdp).not.toBe(CHROME_AUDIO);
    expect(fmtpMap(tuned.sdp ?? "", "111")["usedtx"]).toBe("0");
  });

  it("returns the original object when there is nothing to change", () => {
    const description = { type: "answer" as const, sdp: "v=0\r\n" };
    expect(tuneLocalDescription(description)).toBe(description);
  });
});

describe("opusFirstCodecList", () => {
  const codec = (mimeType: string): RTCRtpCodec => ({
    mimeType,
    clockRate: 48000,
    channels: 2,
  });

  it("puts Opus first and keeps every other codec", () => {
    const ordered = opusFirstCodecList([
      codec("audio/PCMU"),
      codec("audio/opus"),
      codec("audio/telephone-event"),
    ]);
    expect(ordered?.map((c) => c.mimeType)).toEqual([
      "audio/opus",
      "audio/PCMU",
      "audio/telephone-event",
    ]);
  });

  it("never drops DTMF or comfort noise, which some stacks require", () => {
    const input = [codec("audio/opus"), codec("audio/CN"), codec("audio/telephone-event")];
    expect(opusFirstCodecList(input)).toHaveLength(input.length);
  });

  it("matches case-insensitively but not on a codec merely named like Opus", () => {
    expect(opusFirstCodecList([codec("audio/OPUS")])?.[0]?.mimeType).toBe("audio/OPUS");
    expect(opusFirstCodecList([codec("audio/opus-clone")])).toBeNull();
  });

  it("returns null when capabilities are unavailable, so the caller can fall back", () => {
    expect(opusFirstCodecList(undefined)).toBeNull();
    expect(opusFirstCodecList([])).toBeNull();
    expect(opusFirstCodecList([codec("audio/PCMU")])).toBeNull();
  });
});


/** Microphone + shared screen audio + screen video, as a real share produces. */
const MIC_AND_SCREEN = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1 2",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:0 PCMU/8000",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=rtpmap:96 VP8/90000",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=mid:2",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10",
  "",
].join("\r\n");

describe("mediaSections", () => {
  it("finds every section with its mid and kind", () => {
    const sections = mediaSections(MIC_AND_SCREEN.split("\r\n"));
    expect(sections.map((section) => [section.kind, section.mid])).toEqual([
      ["audio", "0"],
      ["video", "1"],
      ["audio", "2"],
    ]);
  });

  it("copes with a section that has no mid yet", () => {
    const sections = mediaSections(CHROME_AUDIO.split("\r\n"));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.mid).toBeNull();
  });
});

describe("multiple audio sections", () => {
  it("tunes every audio section, not just the first", () => {
    // The old implementation stopped at the first audio m-line, which left
    // shared screen audio running on whatever the browser defaulted to.
    const tuned = tuneOpusSdp(MIC_AND_SCREEN);
    const sections = tuned.split("m=audio").length - 1;
    expect(sections).toBe(2);
    expect(tuned.match(/usedtx=0/g)).toHaveLength(2);
    expect(tuned.match(/a=ptime:20/g)).toHaveLength(2);
  });

  it("leaves the video section alone", () => {
    const tuned = tuneOpusSdp(MIC_AND_SCREEN);
    expect(tuned).toContain("a=rtpmap:96 VP8/90000");
    expect(tuned).not.toMatch(/a=fmtp:96/);
  });

  it("gives speech and music different profiles by mid", () => {
    const speech = AUDIO_PROFILES.balanced;
    const music = AUDIO_PROFILES.music;
    const tuned = tuneAudioSections(MIC_AND_SCREEN, (section) =>
      section.mid === "2"
        ? { parameters: opusParameters(music), ptime: music.ptime }
        : { parameters: opusParameters(speech), ptime: speech.ptime },
    );

    const [, mic, , screen] = tuned.split("m=");
    // Quality speech: continuous transmission, mono, 64 kbps.
    expect(mic).toContain("usedtx=0");
    expect(mic).toContain("stereo=0");
    expect(mic).toContain("maxaveragebitrate=64000");
    // Music: DTX off — it would clip the quiet passages — stereo, 160 kbps.
    expect(screen).toContain("usedtx=0");
    expect(screen).toContain("stereo=1");
    expect(screen).toContain("sprop-stereo=1");
    expect(screen).toContain("maxaveragebitrate=160000");
  });

  it("falls back for a section whose mid is not in the plan", () => {
    const speech = AUDIO_PROFILES.economy;
    const tuned = tuneLocalDescription(
      { type: "offer", sdp: MIC_AND_SCREEN },
      {
        byMid: new Map(),
        fallback: { parameters: opusParameters(speech), ptime: speech.ptime },
      },
    );
    expect(tuned.sdp?.match(/maxaveragebitrate=32000/g)).toHaveLength(2);
  });

  it("promotes Opus in every audio m-line", () => {
    const reordered = preferOpusInSdp(
      MIC_AND_SCREEN.replace(
        "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 0 111",
      ),
    );
    for (const line of reordered.split("\r\n")) {
      if (line.startsWith("m=audio")) {
        expect(line.split(" ")[3]).toBe("111");
      }
    }
  });

  it("is still idempotent across several sections", () => {
    const once = tuneOpusSdp(MIC_AND_SCREEN);
    expect(tuneOpusSdp(once)).toBe(once);
  });
});

describe("screenVideoCodecList", () => {
  const codec = (mimeType: string): RTCRtpCodec => ({
    mimeType,
    clockRate: 90000,
  });

  it("puts VP9 first for desktop content", () => {
    // Large flat areas and sharp text survive VP9 far better than VP8.
    const ordered = screenVideoCodecList([
      codec("video/VP8"),
      codec("video/H264"),
      codec("video/VP9"),
      codec("video/AV1"),
    ]);
    expect(ordered?.map((entry) => entry.mimeType)).toEqual([
      "video/VP9",
      "video/AV1",
      "video/VP8",
      "video/H264",
    ]);
  });

  it("never drops a codec, including RTX and FEC entries", () => {
    const input = [
      codec("video/VP8"),
      codec("video/rtx"),
      codec("video/red"),
      codec("video/VP9"),
    ];
    const ordered = screenVideoCodecList(input);
    expect(ordered).toHaveLength(input.length);
    expect(ordered?.map((entry) => entry.mimeType)).toContain("video/rtx");
  });

  it("keeps the browser order when nothing is recognised", () => {
    expect(screenVideoCodecList([codec("video/unknown")])).toBeNull();
    expect(screenVideoCodecList([])).toBeNull();
    expect(screenVideoCodecList(undefined)).toBeNull();
  });

  it("preserves relative order among equally ranked codecs", () => {
    const ordered = screenVideoCodecList([
      codec("video/rtx"),
      codec("video/red"),
      codec("video/VP9"),
    ]);
    expect(ordered?.map((entry) => entry.mimeType)).toEqual([
      "video/VP9",
      "video/rtx",
      "video/red",
    ]);
  });
});
