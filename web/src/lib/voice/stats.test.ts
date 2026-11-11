import { describe, expect, it } from "vitest";
import {
  receivedAudioByMid,
  summariseMediaCounters,
  summariseStats,
  type StatsEntry,
} from "./stats";

/** The shape of a real RTCStatsReport: a Map keyed by id, with forEach over the values. */
function report(...entries: StatsEntry[]): Map<string, StatsEntry> {
  return new Map(entries.map((entry, index) => [`id-${index}`, entry]));
}

describe("summariseStats", () => {
  it("reads a Map-shaped report through forEach, not through its [id, entry] pairs", () => {
    expect(
      summariseStats(
        report({ type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.03, roundTripTime: 0.2 }),
      ),
    ).toEqual({ lossFraction: 0.03, rttMs: 200 });
  });

  it("ignores receiver reports about video", () => {
    expect(
      summariseStats(
        report({ type: "remote-inbound-rtp", kind: "video", fractionLost: 0.5, roundTripTime: 2 }),
      ),
    ).toBeNull();
  });

  it("clamps a reported loss into 0..1", () => {
    expect(
      summariseStats(
        report({ type: "remote-inbound-rtp", kind: "audio", fractionLost: 4, roundTripTime: 0.01 }),
      ),
    ).toEqual({ lossFraction: 1, rttMs: 10 });
    expect(
      summariseStats(
        report({ type: "remote-inbound-rtp", kind: "audio", fractionLost: -1, roundTripTime: 0.01 }),
      )?.lossFraction,
    ).toBe(0);
  });

  it("takes RTT from the receiver report even when only loss is missing", () => {
    expect(
      summariseStats(
        report(
          { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.5 },
          { type: "remote-inbound-rtp", kind: "audio", roundTripTime: 0.04 },
        ),
      ),
    ).toEqual({ lossFraction: 0, rttMs: 40 });
  });

  it("accepts a succeeded pair that is not nominated yet", () => {
    expect(
      summariseStats([{ type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.06 }]),
    ).toEqual({ lossFraction: 0, rttMs: 60 });
  });
});

describe("summariseMediaCounters", () => {
  it("reads the kind from mediaType when the browser omits it", () => {
    expect(
      summariseMediaCounters(
        report({ type: "inbound-rtp", mediaType: "audio", packetsReceived: 2, bytesReceived: 120 }),
      ),
    ).toEqual({ bytesSent: 0, bytesReceived: 120, packetsSent: 0, packetsReceived: 2 });
  });

  it("counts a missing, negative or non-finite counter as zero", () => {
    expect(
      summariseMediaCounters([
        { type: "outbound-rtp", kind: "audio", packetsSent: -5, bytesSent: Number.NaN },
        { type: "outbound-rtp", kind: "audio", packetsSent: 6 },
      ]),
    ).toEqual({ bytesSent: 0, bytesReceived: 0, packetsSent: 6, packetsReceived: 0 });
  });

  it("reports a stream that exists but has sent nothing yet, as opposed to no stream", () => {
    expect(summariseMediaCounters([{ type: "outbound-rtp", kind: "audio" }])).toEqual({
      bytesSent: 0,
      bytesReceived: 0,
      packetsSent: 0,
      packetsReceived: 0,
    });
    expect(summariseMediaCounters([{ type: "outbound-rtp", kind: "video", packetsSent: 9 }])).toBeNull();
  });
});

describe("receivedAudioByMid", () => {
  it("counts the audio packets of each receiving section apart", () => {
    const byMid = receivedAudioByMid(
      report(
        { type: "inbound-rtp", kind: "audio", mid: "b1", packetsReceived: 40 },
        { type: "inbound-rtp", kind: "audio", mid: "c1", packetsReceived: 7 },
        { type: "inbound-rtp", kind: "video", mid: "b2", packetsReceived: 900 },
        { type: "outbound-rtp", kind: "audio", mid: "0", packetsSent: 50 },
        { type: "inbound-rtp", kind: "audio", packetsReceived: 3 },
      ),
    );

    expect([...byMid]).toEqual([
      ["b1", 40],
      ["c1", 7],
    ]);
  });

  it("reads a missing counter as nothing received", () => {
    expect(receivedAudioByMid([{ type: "inbound-rtp", kind: "audio", mid: "b1" }]).get("b1")).toBe(0);
  });
});
