import { describe, expect, it } from "vitest";
import { AdaptiveBitrateController, classify } from "./bitrate";
import { summariseMediaCounters, summariseStats, worstSample } from "./stats";

const CEILING = 64000;
const FLOOR = 24000;

function controller(overrides = {}) {
  return new AdaptiveBitrateController({
    ceiling: CEILING,
    floor: FLOOR,
    // No smoothing lag in most cases, so the tier logic is what is under test.
    smoothing: 1,
    ...overrides,
  });
}

const GOOD = { lossFraction: 0, rttMs: 40 };
const FAIR = { lossFraction: 0.04, rttMs: 120 };
const POOR = { lossFraction: 0.2, rttMs: 500 };

function feed(
  control: AdaptiveBitrateController,
  sample: { lossFraction: number; rttMs: number },
  times: number,
) {
  let last = control.observe(sample);
  for (let i = 1; i < times; i += 1) last = control.observe(sample);
  return last;
}

describe("classify", () => {
  it("takes the worse of loss and latency", () => {
    expect(classify({ lossFraction: 0, rttMs: 20 })).toBe("good");
    expect(classify({ lossFraction: 0.03, rttMs: 20 })).toBe("fair");
    // Loss is fine but the link is slow.
    expect(classify({ lossFraction: 0, rttMs: 200 })).toBe("fair");
    expect(classify({ lossFraction: 0.1, rttMs: 20 })).toBe("poor");
    expect(classify({ lossFraction: 0, rttMs: 400 })).toBe("poor");
  });
});

describe("AdaptiveBitrateController", () => {
  it("starts at the profile ceiling", () => {
    const control = controller();
    expect(control.getBitrate()).toBe(CEILING);
    expect(control.getQuality()).toBe("unknown");
  });

  it("drops after a couple of bad samples, not the first one", () => {
    const control = controller({ downgradeAfter: 2 });

    expect(control.observe(POOR).changed).toBe(false);
    expect(control.getBitrate()).toBe(CEILING);

    const second = control.observe(POOR);
    expect(second.changed).toBe(true);
    expect(second.quality).toBe("poor");
    expect(second.bitrate).toBeLessThan(CEILING);
  });

  it("recovers only after sustained good samples", () => {
    const control = controller({ downgradeAfter: 2, upgradeAfter: 5 });
    feed(control, POOR, 2);
    const dropped = control.getBitrate();

    // Four good samples are not enough: a link that just misbehaved usually will
    // again, and oscillating is worse than staying conservative.
    feed(control, GOOD, 4);
    expect(control.getBitrate()).toBe(dropped);

    const recovered = control.observe(GOOD);
    expect(recovered.changed).toBe(true);
    expect(recovered.bitrate).toBe(CEILING);
  });

  it("never oscillates on a link flapping between tiers", () => {
    const control = controller({ downgradeAfter: 2, upgradeAfter: 5 });
    const changes: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const decision = control.observe(i % 2 === 0 ? GOOD : POOR);
      if (decision.changed) changes.push(decision.bitrate);
    }
    // Alternating samples never accumulate a streak, so nothing is applied.
    expect(changes).toEqual([]);
  });

  it("stays within the profile's floor and ceiling", () => {
    const control = controller({ downgradeAfter: 1 });
    feed(control, { lossFraction: 0.9, rttMs: 5000 }, 5);
    expect(control.getBitrate()).toBeGreaterThanOrEqual(FLOOR);
    expect(control.getBitrate()).toBeLessThanOrEqual(CEILING);
  });

  it("respects a floor that would otherwise be undercut", () => {
    const control = new AdaptiveBitrateController({
      ceiling: 32000,
      floor: 30000,
      smoothing: 1,
      downgradeAfter: 1,
      // The 45% "poor" target is 14.4 kbps here, far under the floor; the
      // relative-change guard is relaxed so the clamp is what is under test.
      minRelativeChange: 0.01,
    });
    feed(control, POOR, 3);
    expect(control.getBitrate()).toBe(30000);
  });

  it("ignores a change too small to be worth applying", () => {
    const control = new AdaptiveBitrateController({
      ceiling: 64000,
      floor: 63000,
      smoothing: 1,
      downgradeAfter: 1,
      // A 1.5% move is not worth touching the encoder for.
      minRelativeChange: 0.1,
    });
    const decision = feed(control, FAIR, 2);
    expect(decision.changed).toBe(false);
    expect(control.getBitrate()).toBe(64000);
  });

  it("smooths, so one freak sample moves nothing", () => {
    const control = controller({ smoothing: 0.3, downgradeAfter: 2 });
    control.observe(GOOD);
    control.observe(GOOD);
    // A single spike is diluted below the fair threshold.
    const decision = control.observe({ lossFraction: 0.09, rttMs: 60 });
    expect(decision.changed).toBe(false);
  });

  it("clamps nonsense readings instead of propagating them", () => {
    const control = controller({ downgradeAfter: 1 });
    control.observe({ lossFraction: 5, rttMs: -100 });
    const sample = control.getSample();
    expect(sample?.lossFraction).toBeLessThanOrEqual(1);
    expect(sample?.rttMs).toBeGreaterThanOrEqual(0);
  });

  it("re-bounds itself when the profile changes", () => {
    const control = controller({ downgradeAfter: 1 });
    feed(control, POOR, 2);

    control.setCeiling(32000, 16000);
    expect(control.getBitrate()).toBeLessThanOrEqual(32000);
    expect(control.getBitrate()).toBeGreaterThanOrEqual(16000);
  });

  it("returns to the ceiling on reset", () => {
    const control = controller({ downgradeAfter: 1 });
    feed(control, POOR, 3);
    control.reset();
    expect(control.getBitrate()).toBe(CEILING);
    expect(control.getQuality()).toBe("unknown");
    expect(control.getSample()).toBeNull();
  });
});

describe("summariseStats", () => {
  it("reads loss and RTT from the remote receiver report", () => {
    const report = [
      { type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.05, roundTripTime: 0.12 },
      { type: "outbound-rtp", kind: "audio", packetsSent: 100 },
    ];
    expect(summariseStats(report)).toEqual({ lossFraction: 0.05, rttMs: 120 });
  });

  it("falls back to the nominated candidate pair for RTT", () => {
    // Available as soon as ICE settles, well before the first RTCP report.
    const report = [
      { type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.08 },
    ];
    expect(summariseStats(report)).toEqual({ lossFraction: 0, rttMs: 80 });
  });

  it("ignores a candidate pair that is not carrying media", () => {
    const report = [
      { type: "candidate-pair", state: "failed", currentRoundTripTime: 9 },
    ];
    expect(summariseStats(report)).toBeNull();
  });

  it("prefers the receiver report over the candidate pair", () => {
    const report = [
      { type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 1 },
      { type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.01, roundTripTime: 0.05 },
    ];
    expect(summariseStats(report)?.rttMs).toBe(50);
  });

  it("accepts a Map-shaped report, as the browser returns", () => {
    const report = new Map([
      ["a", { type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.02, roundTripTime: 0.1 }],
    ]);
    expect(summariseStats(report.values() as never)).toEqual({
      lossFraction: 0.02,
      rttMs: 100,
    });
  });

  it("returns null when there is nothing usable yet", () => {
    expect(summariseStats([])).toBeNull();
    expect(summariseStats([{ type: "transport" }])).toBeNull();
  });

  it("ignores non-finite values rather than poisoning the controller", () => {
    const report = [
      {
        type: "remote-inbound-rtp",
        kind: "audio",
        fractionLost: Number.NaN,
        roundTripTime: Number.POSITIVE_INFINITY,
      },
    ];
    expect(summariseStats(report)).toBeNull();
  });
});

describe("summariseMediaCounters", () => {
  it("sums only audio RTP in both directions", () => {
    expect(
      summariseMediaCounters([
        { type: "outbound-rtp", kind: "audio", packetsSent: 4, bytesSent: 400 },
        { type: "outbound-rtp", mediaType: "audio", packetsSent: 3, bytesSent: 300 },
        { type: "inbound-rtp", kind: "audio", packetsReceived: 5, bytesReceived: 500 },
        { type: "inbound-rtp", kind: "video", packetsReceived: 99, bytesReceived: 9_999 },
      ]),
    ).toEqual({
      bytesSent: 700,
      bytesReceived: 500,
      packetsSent: 7,
      packetsReceived: 5,
    });
  });

  it("returns null until the browser exposes an audio RTP report", () => {
    expect(summariseMediaCounters([{ type: "candidate-pair" }])).toBeNull();
  });
});

describe("worstSample", () => {
  it("takes the worst of each dimension across the readings", () => {
    // The call is only as good as its weakest reading.
    expect(
      worstSample([
        { lossFraction: 0.01, rttMs: 200 },
        { lossFraction: 0.2, rttMs: 30 },
      ]),
    ).toEqual({ lossFraction: 0.2, rttMs: 200 });
  });

  it("is null with nothing to compare", () => {
    expect(worstSample([])).toBeNull();
  });
});


describe("profile switching moves both bounds", () => {
  // Regression: `setCeiling` used to compute a local `nextFloor` for the
  // immediate clamp while `floor` stayed readonly, so every later `observe()`
  // kept clamping against the *previous* profile's floor.
  const ECONOMY = { ceiling: 32000, floor: 16000 };
  const CLARITY = { ceiling: 96000, floor: 32000 };

  it("reports the bounds it is actually honouring", () => {
    const control = new AdaptiveBitrateController({ ...ECONOMY, smoothing: 1 });
    control.setCeiling(CLARITY.ceiling, CLARITY.floor);
    expect(control.getBounds()).toEqual({ ceiling: 96000, floor: 32000 });
  });

  it("economy → clarity raises the floor for later samples", () => {
    const control = new AdaptiveBitrateController({
      ...ECONOMY,
      smoothing: 1,
      downgradeAfter: 1,
      minRelativeChange: 0.01,
    });
    control.setCeiling(CLARITY.ceiling, CLARITY.floor);

    // A dreadful link: the tier target is far below either floor, so whichever
    // floor is in force is exactly what comes out.
    const decision = feed(control, { lossFraction: 0.9, rttMs: 5000 }, 3);

    expect(decision.bitrate).toBeGreaterThanOrEqual(CLARITY.floor);
    // The old code clamped to economy's 16000 here.
    expect(decision.bitrate).not.toBe(ECONOMY.floor);
    expect(control.getBounds().floor).toBe(CLARITY.floor);
  });

  it("clarity → economy lowers both bounds for later samples", () => {
    const control = new AdaptiveBitrateController({
      ...CLARITY,
      smoothing: 1,
      downgradeAfter: 1,
      minRelativeChange: 0.01,
    });
    // Get into a poor state on the big profile first.
    feed(control, POOR, 3);
    expect(control.getBitrate()).toBeGreaterThan(ECONOMY.ceiling);

    control.setCeiling(ECONOMY.ceiling, ECONOMY.floor);

    // Immediately re-bounded...
    expect(control.getBitrate()).toBeLessThanOrEqual(ECONOMY.ceiling);
    // ...and it stays re-bounded as more samples arrive.
    const decision = feed(control, POOR, 3);
    expect(decision.bitrate).toBeLessThanOrEqual(ECONOMY.ceiling);
    expect(decision.bitrate).toBeGreaterThanOrEqual(ECONOMY.floor);
    expect(control.getBounds()).toEqual({ ceiling: 32000, floor: 16000 });
  });

  it("keeps the poor-network target inside the new profile after a switch", () => {
    const control = new AdaptiveBitrateController({
      ...CLARITY,
      smoothing: 1,
      downgradeAfter: 1,
      minRelativeChange: 0.01,
    });
    feed(control, POOR, 2);
    control.setCeiling(ECONOMY.ceiling, ECONOMY.floor);

    for (let i = 0; i < 10; i += 1) {
      const { bitrate } = control.observe(POOR);
      expect(bitrate).toBeLessThanOrEqual(ECONOMY.ceiling);
      expect(bitrate).toBeGreaterThanOrEqual(ECONOMY.floor);
    }
  });

  it("never lets the floor exceed the new ceiling", () => {
    const control = new AdaptiveBitrateController({
      ceiling: 96000,
      floor: 64000,
      smoothing: 1,
    });
    // A floor above the ceiling would pin the controller and make backing off
    // impossible; it is clamped down instead.
    control.setCeiling(32000);
    expect(control.getBounds().floor).toBeLessThanOrEqual(32000);
    expect(control.getBitrate()).toBeLessThanOrEqual(32000);
  });

  it("keeps the previous floor when the caller omits one", () => {
    const control = new AdaptiveBitrateController({ ...CLARITY, smoothing: 1 });
    control.setCeiling(64000);
    expect(control.getBounds()).toEqual({ ceiling: 64000, floor: 32000 });
  });
});
