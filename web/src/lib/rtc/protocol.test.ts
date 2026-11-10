import { describe, expect, it } from "vitest";
import {
  decodeRtcCandidate,
  decodeRtcDescription,
  decodeRtcState,
  encodeRtcCandidate,
  encodeRtcDescription,
  encodeRtcState,
  isRtcSignalKind,
  RTC_PROTOCOL_VERSION,
} from "./protocol";

describe("Stellarr RTC protocol v1", () => {
  it("has one explicit wire version and a closed signal-kind set", () => {
    expect(RTC_PROTOCOL_VERSION).toBe(1);
    expect(isRtcSignalKind("offer")).toBe(true);
    expect(isRtcSignalKind("renegotiate")).toBe(false);
  });

  it("round-trips descriptions without accepting a mismatched kind", () => {
    const payload = encodeRtcDescription("offer", "v=0\r\n");
    expect(decodeRtcDescription(payload, "offer")).toEqual({
      type: "offer",
      sdp: "v=0\r\n",
    });
    expect(decodeRtcDescription(payload, "answer")).toBeNull();
  });

  it("distinguishes end-of-candidates from a malformed candidate", () => {
    expect(decodeRtcCandidate(encodeRtcCandidate(null))).toBeNull();
    expect(
      decodeRtcCandidate(
        encodeRtcCandidate({ candidate: "candidate:1", sdpMid: "0" }),
      ),
    ).toEqual({ candidate: "candidate:1", sdpMid: "0" });
    expect(decodeRtcCandidate('{"candidate":42}')).toBeUndefined();
    expect(decodeRtcCandidate("not-json")).toBeUndefined();
  });

  it("requires the complete participant-state payload", () => {
    const state = {
      muted: true,
      screenStreamId: "screen-1",
      cameraStreamId: "camera-1",
    };
    expect(decodeRtcState(encodeRtcState(state))).toEqual(state);
    expect(decodeRtcState('{"muted":true}')).toBeNull();
    expect(decodeRtcState('{"muted":"yes","screenStreamId":null}')).toBeNull();
  });

  it("accepts cameraStreamId as an optional RTC v1 extension", () => {
    expect(
      decodeRtcState('{"muted":false,"screenStreamId":null}'),
    ).toEqual({ muted: false, screenStreamId: null, cameraStreamId: null });
    expect(
      decodeRtcState(
        '{"muted":false,"screenStreamId":null,"cameraStreamId":42}',
      ),
    ).toBeNull();
  });
});
