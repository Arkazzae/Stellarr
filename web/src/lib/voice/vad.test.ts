import { describe, expect, it } from "vitest";
import {
  AdaptiveVad,
  GATE_DEFAULTS,
  GateSmoother,
  LEVEL_STEPS,
  LEVELLER_DEFAULTS,
  Leveller,
  VadPublisher,
  VAD_DEFAULTS,
  VoicingDetector,
  frameMeanSquare,
  framePeakAbs,
  meanSquareToDbfs,
  sensitivityToThresholds,
} from "../../../public/audio/vad-processor.js";

const SAMPLE_RATE = 48000;
const FRAME = Math.round((SAMPLE_RATE * VAD_DEFAULTS.frameMs) / 1000);

function vad(overrides: Partial<typeof VAD_DEFAULTS> = {}) {
  return new AdaptiveVad({ sampleRate: SAMPLE_RATE, ...overrides });
}

/** Deterministic pseudo-noise: a fixed LCG, so a failure is always reproducible. */
function noise(amplitude: number, length: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out[i] = ((state / 2147483648) * 2 - 1) * amplitude;
  }
  return out;
}

function tone(amplitude: number, length: number, hz = 220): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amplitude;
  }
  return out;
}

/** A repeatable speech-like envelope: strongly modulated rather than a lab tone. */
function speechFrame(index: number): Float32Array {
  const envelope = [0.08, 0.13, 0.24, 0.4, 0.31, 0.17, 0.1, 0.05][index % 8] ?? 0.1;
  return tone(envelope, FRAME, 185 + (index % 5) * 17);
}

/** Short, decaying broadband impact similar to a key or controller switch. */
function clickFrame(amplitude = 0.8): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < 72; i += 1) {
    out[i] =
      amplitude * Math.exp(-i / 18) * (i % 2 === 0 ? 1 : -0.72);
  }
  return out;
}

/** Feed `frames` frames of the given signal, returning the last result. */
function feed(
  detector: AdaptiveVad,
  make: (index: number) => Float32Array,
  frames: number,
) {
  let last = detector.processFrame(new Float32Array(FRAME));
  for (let i = 0; i < frames; i += 1) last = detector.processFrame(make(i));
  return last;
}

describe("frame energy", () => {
  it("is clipping-safe: samples beyond full scale cannot exceed unity energy", () => {
    const hot = new Float32Array([4, -9, 2.5, -3]);
    expect(frameMeanSquare(hot)).toBe(1);
    expect(meanSquareToDbfs(frameMeanSquare(hot))).toBe(0);
  });

  it("drops NaN and Infinity instead of poisoning the average", () => {
    const torn = new Float32Array([0.5, Number.NaN, 0.5, Number.POSITIVE_INFINITY]);
    const energy = frameMeanSquare(torn);
    expect(Number.isFinite(energy)).toBe(true);
    // Non-finite samples count as 0, not as full scale: a torn buffer is
    // corruption, and treating it as a loud frame would fire the indicator.
    expect(energy).toBeCloseTo(0.125, 6);
  });

  it("floors digital silence instead of returning -Infinity", () => {
    expect(Number.isFinite(meanSquareToDbfs(0))).toBe(true);
    expect(meanSquareToDbfs(0)).toBeLessThan(-100);
  });

  it("measures a full-scale square wave as 0 dBFS", () => {
    expect(meanSquareToDbfs(frameMeanSquare(new Float32Array([1, -1, 1, -1])))).toBe(0);
  });

  it("measures crest without trusting corrupt or clipped samples", () => {
    expect(framePeakAbs(new Float32Array([0.25, -4, Number.NaN]))).toBe(1);
  });
});

describe("frame accumulation", () => {
  it("emits one result per 10 ms frame and nothing for a partial frame", () => {
    const detector = vad();
    expect(detector.frameSize).toBe(480);

    // A 128-sample render quantum is less than a frame: no result yet.
    expect(detector.push(new Float32Array(128))).toHaveLength(0);
    expect(detector.push(new Float32Array(128))).toHaveLength(0);
    expect(detector.push(new Float32Array(128))).toHaveLength(0);
    // 4 x 128 = 512 > 480, so the fourth quantum completes exactly one frame.
    expect(detector.push(new Float32Array(128))).toHaveLength(1);
  });

  it("carries the remainder across chunks rather than dropping it", () => {
    const detector = vad();
    const results = detector.push(new Float32Array(FRAME * 3 + 7));
    expect(results).toHaveLength(3);
    // 7 samples are still buffered; 473 more complete the fourth frame.
    expect(detector.push(new Float32Array(FRAME - 7))).toHaveLength(1);
  });

  it("adapts the frame size to a non-48 kHz context", () => {
    expect(vad({ sampleRate: 44100 }).frameSize).toBe(441);
    expect(vad({ sampleRate: 16000 }).frameSize).toBe(160);
  });

  it("reuses the caller's output array so the hot path allocates nothing", () => {
    const detector = vad();
    const out: unknown[] = [];
    const first = detector.push(new Float32Array(FRAME), out as never);
    const second = detector.push(new Float32Array(FRAME), out as never);
    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(out).toHaveLength(1);
  });
});

describe("adaptive detection", () => {
  it("suppresses detection until the floor has learned the room", () => {
    const detector = vad();
    // Without a warm-up the initial floor sits ~25 dB below any real room, so
    // the very first frame looks like a huge SNR event and latches on forever.
    const loudFromTheStart = () => tone(0.4, FRAME);
    for (let i = 0; i < VAD_DEFAULTS.warmupFrames; i += 1) {
      detector.processFrame(loudFromTheStart());
      expect(detector.speaking).toBe(false);
    }
    expect(detector.warmingUp).toBe(false);
  });

  it("stays silent through digital silence", () => {
    const detector = vad();
    const result = feed(detector, () => new Float32Array(FRAME), 200);
    expect(result.speaking).toBe(false);
    expect(result.level).toBeLessThan(0.05);
  });

  it("does not fire on steady room noise, however long it runs", () => {
    const detector = vad();
    const result = feed(detector, (i) => noise(0.01, FRAME, i + 1), 500);
    expect(result.speaking).toBe(false);
  });

  it("confirms speech within 30 ms instead of firing on a single spike", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    expect(detector.speaking).toBe(false);

    // One click or key impact is ignored.
    detector.processFrame(tone(0.4, FRAME));
    expect(detector.speaking).toBe(false);
    detector.processFrame(tone(0.4, FRAME));
    expect(detector.speaking).toBe(false);
    detector.processFrame(tone(0.4, FRAME));
    expect(detector.speaking).toBe(true);
  });

  it("rejects repeated keyboard and controller-like impacts", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);

    for (let click = 0; click < 20; click += 1) {
      const result = detector.processFrame(clickFrame(0.45 + (click % 4) * 0.1));
      expect(result.transient).toBe(true);
      feed(detector, (i) => noise(0.01, FRAME, click * 20 + i + 5000), 9);
      expect(detector.speaking).toBe(false);
    }
  });

  it("opens for real speech shortly after a rejected impact", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    expect(detector.processFrame(clickFrame()).transient).toBe(true);

    feed(detector, (i) => speechFrame(i), 9);
    expect(detector.speaking).toBe(true);
  });

  it("does not let a click reuse an old speech hangover", () => {
    const detector = vad({ hangoverFrames: 45 });
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    feed(detector, (i) => speechFrame(i), 10);
    expect(detector.speaking).toBe(true);

    // The ordinary 450 ms hangover is still open after this natural pause.
    feed(detector, (i) => noise(0.01, FRAME, i + 900), 10);
    expect(detector.speaking).toBe(true);

    const click = detector.processFrame(clickFrame());
    expect(click.transient).toBe(true);
    expect(click.speaking).toBe(false);
  });

  it("finishes cold-start learning in at most 130 ms", () => {
    const detector = vad();
    let frames = 0;
    while (detector.warmingUp && frames < 100) {
      detector.processFrame(noise(0.01, FRAME, frames + 1));
      frames += 1;
    }
    expect(frames * VAD_DEFAULTS.frameMs).toBeLessThanOrEqual(130);
  });

  it("holds through a short gap between syllables", () => {
    const detector = vad({ hangoverFrames: 30 });
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    feed(detector, () => tone(0.4, FRAME), 10);
    expect(detector.speaking).toBe(true);

    // 200 ms of quiet is inside the 300 ms hangover.
    feed(detector, (i) => noise(0.01, FRAME, i + 500), 20);
    expect(detector.speaking).toBe(true);
  });

  it("releases once the gap outlasts the hangover", () => {
    const detector = vad({ hangoverFrames: 30 });
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    feed(detector, () => tone(0.4, FRAME), 10);
    expect(detector.speaking).toBe(true);

    feed(detector, (i) => noise(0.01, FRAME, i + 900), 40);
    expect(detector.speaking).toBe(false);
  });

  it("adapts to a loud room a fixed threshold would misjudge", () => {
    // Noise at 0.05 sits above the old fixed 0.055-ish RMS trip point region;
    // the tracked floor absorbs it and only real speech above it counts.
    const detector = vad();
    const settled = feed(detector, (i) => noise(0.05, FRAME, i + 1), 600);
    expect(settled.speaking).toBe(false);
    expect(detector.noiseFloorDb).toBeGreaterThan(-40);

    feed(detector, () => tone(0.5, FRAME), 5);
    expect(detector.speaking).toBe(true);
  });

  it("still hears quiet speech in a very quiet room", () => {
    const detector = vad();
    feed(detector, () => new Float32Array(FRAME), 300);
    // ~-46 dBFS: far under any fixed threshold, but well above this floor.
    feed(detector, () => tone(0.008, FRAME), 6);
    expect(detector.speaking).toBe(true);
  });

  it("keeps hearing a monologue: speech cannot raise the floor over itself", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);

    // Thirty seconds of continuous speech, the case that deafens a naive
    // tracker within a few seconds.
    const speech = feed(detector, (i) => speechFrame(i), 3000);
    expect(detector.speaking).toBe(true);
    // The floor is still comfortably below even the quiet tail of this frame.
    expect(speech.snrDb).toBeGreaterThan(9.5);
  });

  it("recovers from a new steady noise source within three seconds", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.005, FRAME, i + 1), 200);
    feed(detector, () => tone(0.4, FRAME), 10);
    expect(detector.speaking).toBe(true);

    // Someone starts a fan: loud enough to clear the release threshold against
    // the old floor. The UI must not remain stuck on "speaking" for minutes.
    feed(detector, (i) => noise(0.12, FRAME, i + 7000), 300);
    expect(detector.speaking).toBe(false);
  });

  it("learns a quiet microphone floor below the speech cutoff", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.0005, FRAME, i + 1), 100);
    expect(detector.noiseFloorDb).toBeLessThan(-60);
    expect(detector.speaking).toBe(false);
  });

  it("keeps the floor inside its clamps even for pathological input", () => {
    const detector = vad();
    feed(detector, () => new Float32Array(FRAME), 50);
    expect(detector.noiseFloorDb).toBeGreaterThanOrEqual(VAD_DEFAULTS.noiseFloorMinDb);

    const loud = vad();
    feed(loud, () => tone(1, FRAME), 500);
    expect(loud.noiseFloorDb).toBeLessThanOrEqual(VAD_DEFAULTS.noiseFloorMaxDb);
  });

  it("reports a level that rises with loudness and stays in range", () => {
    const quiet = vad();
    const quietResult = feed(quiet, () => tone(0.02, FRAME), 40);
    const loud = vad();
    const loudResult = feed(loud, () => tone(0.6, FRAME), 40);

    expect(quietResult.level).toBeGreaterThanOrEqual(0);
    expect(loudResult.level).toBeLessThanOrEqual(1);
    expect(loudResult.level).toBeGreaterThan(quietResult.level);
  });

  it("ignores digital silence so an unmute cannot flash a phantom onset", () => {
    const detector = vad();
    const settled = feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    const floorBefore = detector.noiseFloorDb;
    expect(settled.speaking).toBe(false);

    // A muted peer's track is all zeroes. The floor must not follow it down.
    feed(detector, () => new Float32Array(FRAME), 100);
    expect(detector.noiseFloorDb).toBeCloseTo(floorBefore, 5);

    // Unmuting back into the same room is not a speaking event.
    feed(detector, (i) => noise(0.01, FRAME, i + 4000), 5);
    expect(detector.speaking).toBe(false);
  });

  it("returns to its initial state on reset", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    feed(detector, () => tone(0.5, FRAME), 10);
    expect(detector.speaking).toBe(true);

    detector.reset();
    expect(detector.speaking).toBe(false);
    expect(detector.level).toBe(0);
    expect(detector.noiseFloorDb).toBe(VAD_DEFAULTS.noiseFloorInitDb);
    expect(detector.warmingUp).toBe(true);
  });
});

describe("worklet messaging", () => {
  it("posts a speaking change immediately, without waiting for the rate limit", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 4 });
    const message = publisher.consider({ speaking: true, level: 0.5 });
    expect(message).toEqual({ speaking: true, level: 0.5 });
  });

  it("posts one baseline, then stays quiet while nothing changes", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 4 });
    // The first level crossing establishes the baseline the UI starts from.
    const posts = [];
    for (let i = 0; i < 40; i += 1) {
      const message = publisher.consider({ speaking: false, level: 0.001 });
      if (message) posts.push(message);
    }
    expect(posts).toEqual([{ speaking: false, level: 0 }]);
  });

  it("rate-limits level-only changes to one message per N frames", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 4 });
    // Prime past the baseline so the counter starts from a known post.
    while (publisher.consider({ speaking: false, level: 0 }) === null) {
      /* advance to the baseline post */
    }

    // The next three frames are suppressed even though the level moved.
    expect(publisher.consider({ speaking: false, level: 0.25 })).toBeNull();
    expect(publisher.consider({ speaking: false, level: 0.375 })).toBeNull();
    expect(publisher.consider({ speaking: false, level: 0.5 })).toBeNull();
    expect(publisher.consider({ speaking: false, level: 0.625 })).toEqual({
      speaking: false,
      level: 0.625,
    });
  });

  it("never delays a speaking change behind the level rate limit", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 1000 });
    publisher.consider({ speaking: false, level: 0 });
    expect(publisher.consider({ speaking: true, level: 0 })).toEqual({
      speaking: true,
      level: 0,
    });
  });

  it("quantises the level to the steps the meter can draw", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 0 });
    const message = publisher.consider({ speaking: false, level: 0.4213 });
    expect(message?.level).toBe(Math.round(0.4213 * LEVEL_STEPS) / LEVEL_STEPS);
  });

  it("clamps an out-of-range level rather than emitting a bad step", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 0 });
    expect(publisher.consider({ speaking: false, level: 4 })?.level).toBe(1);
    const low = new VadPublisher({ minFramesBetweenLevelPosts: 0 });
    expect(low.consider({ speaking: true, level: -3 })?.level).toBe(0);
  });

  it("re-announces after a reset so a new subscriber is not left stale", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 0 });
    publisher.consider({ speaking: true, level: 0.5 });
    expect(publisher.consider({ speaking: true, level: 0.5 })).toBeNull();

    publisher.reset();
    expect(publisher.consider({ speaking: true, level: 0.5 })).toEqual({
      speaking: true,
      level: 0.5,
    });
  });

  it("emits a compact payload — nothing the UI cannot use", () => {
    const publisher = new VadPublisher({ minFramesBetweenLevelPosts: 0 });
    const message = publisher.consider({ speaking: true, level: 0.5 });
    expect(Object.keys(message ?? {}).sort()).toEqual(["level", "speaking"]);
  });

  it("publishes one clean release but no remote room-noise levels", () => {
    const publisher = new VadPublisher({
      minFramesBetweenLevelPosts: 0,
      publishSilentLevels: false,
    });
    expect(publisher.consider({ speaking: false, level: 0.5 })).toBeNull();
    expect(publisher.consider({ speaking: true, level: 0.75 })).toEqual({
      speaking: true,
      level: 0.75,
    });
    expect(publisher.consider({ speaking: false, level: 0.5 })).toEqual({
      speaking: false,
      level: 0,
    });
    expect(publisher.consider({ speaking: false, level: 0.25 })).toBeNull();
  });
});


describe("sensitivity mapping", () => {
  it("sweeps the on-threshold from strict to permissive", () => {
    // 0 = only clear speech above the room; 100 = a whisper counts.
    expect(sensitivityToThresholds(0).snrOnDb).toBe(14);
    expect(sensitivityToThresholds(100).snrOnDb).toBe(3);
    expect(sensitivityToThresholds(50).snrOnDb).toBeCloseTo(8.5, 1);
  });

  it("moves monotonically, so the dial always feels the right way round", () => {
    let previous = Infinity;
    for (let value = 0; value <= 100; value += 5) {
      const { snrOnDb } = sensitivityToThresholds(value);
      expect(snrOnDb).toBeLessThan(previous);
      previous = snrOnDb;
    }
  });

  it("always keeps hysteresis, at both ends of the dial", () => {
    for (const value of [0, 25, 50, 75, 100]) {
      const { snrOnDb, snrOffDb } = sensitivityToThresholds(value);
      expect(snrOffDb).toBeLessThan(snrOnDb);
      // Never so low that room noise alone holds the gate open.
      expect(snrOffDb).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("lengthens the hangover as sensitivity rises", () => {
    // A quiet talker leaves bigger gaps; chopping them would be worse.
    expect(sensitivityToThresholds(100).hangoverFrames).toBeGreaterThan(
      sensitivityToThresholds(0).hangoverFrames,
    );
  });

  it("clamps anything out of range or not a number", () => {
    expect(sensitivityToThresholds(-50)).toEqual(sensitivityToThresholds(0));
    expect(sensitivityToThresholds(900)).toEqual(sensitivityToThresholds(100));
    expect(sensitivityToThresholds(Number.NaN)).toEqual(sensitivityToThresholds(50));
  });
});

describe("runtime reconfiguration", () => {
  it("changes thresholds without losing the learned noise floor", () => {
    const detector = vad();
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    const floor = detector.noiseFloorDb;

    detector.configure(sensitivityToThresholds(100));

    // Retuning must not restart the warm-up: the dial would feel dead for half
    // a second on every step.
    expect(detector.noiseFloorDb).toBe(floor);
    expect(detector.warmingUp).toBe(false);
  });

  it("makes a quiet sound register only at high sensitivity", () => {
    const quietSpeech = () => tone(0.02, FRAME);

    const strict = vad();
    feed(strict, (i) => noise(0.01, FRAME, i + 1), 200);
    strict.configure(sensitivityToThresholds(0));
    feed(strict, quietSpeech, 6);
    expect(strict.speaking).toBe(false);

    const permissive = vad();
    feed(permissive, (i) => noise(0.01, FRAME, i + 1), 200);
    permissive.configure(sensitivityToThresholds(100));
    feed(permissive, quietSpeech, 6);
    expect(permissive.speaking).toBe(true);
  });

  it("ignores non-numeric values rather than disabling detection", () => {
    const detector = vad();
    const before = { ...detector.config };
    detector.configure({
      snrOnDb: Number.NaN as never,
      hangoverFrames: "lots" as never,
    });
    expect(detector.config.snrOnDb).toBe(before.snrOnDb);
    expect(detector.config.hangoverFrames).toBe(before.hangoverFrames);
  });

  it("repairs an inverted hysteresis instead of accepting it", () => {
    const detector = vad();
    detector.configure({ snrOnDb: 5, snrOffDb: 9 });
    expect(detector.config.snrOffDb).toBeLessThan(detector.config.snrOnDb);
  });

  it("clamps frame counts to at least one frame", () => {
    const detector = vad();
    detector.configure({ attackFrames: 0, hangoverFrames: -5 });
    expect(detector.config.attackFrames).toBeGreaterThanOrEqual(1);
    expect(detector.config.hangoverFrames).toBeGreaterThanOrEqual(1);
  });

  it("does not leave a longer countdown running after a tightened hangover", () => {
    const detector = vad({ hangoverFrames: 60 });
    feed(detector, (i) => noise(0.01, FRAME, i + 1), 200);
    feed(detector, () => tone(0.4, FRAME), 10);
    expect(detector.speaking).toBe(true);

    detector.configure({ hangoverFrames: 3 });
    // Releases on the new, shorter countdown rather than the old one.
    feed(detector, (i) => noise(0.01, FRAME, i + 900), 8);
    expect(detector.speaking).toBe(false);
  });
});

describe("sensitivity → absolute floor", () => {
  it("lowers the absolute floor as sensitivity rises, so a suppressed residue cannot open the gate", () => {
    expect(sensitivityToThresholds(0).absoluteFloorDb).toBe(-45);
    expect(sensitivityToThresholds(100).absoluteFloorDb).toBe(-68);
    expect(sensitivityToThresholds(50).absoluteFloorDb).toBeLessThan(
      sensitivityToThresholds(0).absoluteFloorDb,
    );
  });

  it("keeps a quiet crunch over a near-silent floor from counting at low sensitivity", () => {
    // After RNNoise the floor sits far below -68 dBFS; a -50 dBFS residue is a
    // huge SNR event but still under the strict absolute floor.
    const strict = vad({ ...sensitivityToThresholds(0) });
    feed(strict, () => noise(0.0002, FRAME), 200);
    feed(strict, () => tone(0.004, FRAME), 12);
    expect(strict.speaking).toBe(false);

    const loose = vad({ ...sensitivityToThresholds(100) });
    feed(loose, () => noise(0.0002, FRAME), 200);
    feed(loose, () => tone(0.004, FRAME), 12);
    expect(loose.speaking).toBe(true);
  });
});

describe("gate smoother", () => {
  function block(value: number, length = 128): Float32Array {
    return new Float32Array(length).fill(value);
  }

  it("starts closed and delays the signal by the lookahead", () => {
    const gate = new GateSmoother({ sampleRate: SAMPLE_RATE, lookaheadMs: 10 });
    expect(gate.delaySamples).toBe(480);
    expect(gate.gain).toBe(0);

    gate.setOpen(true);
    const out = new Float32Array(480);
    gate.process(block(1, 480), out);
    // Everything that came out was the zero-filled delay line, ramped or not.
    expect(Math.max(...out)).toBe(0);

    gate.process(block(1, 480), out);
    // Now the delayed ones arrive, on a ramp that has clearly opened.
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[479]).toBeGreaterThan(out[0] ?? 0);
    gate.process(block(1, 4800), new Float32Array(4800));
    expect(gate.gain).toBe(1);
  });

  it("ramps open within the attack time and closes within the release time", () => {
    const gate = new GateSmoother({
      sampleRate: SAMPLE_RATE,
      lookaheadMs: 0,
      attackMs: 5,
      releaseMs: 50,
    });
    gate.setOpen(true);
    const out = new Float32Array(128);
    gate.process(block(1), out);
    // Not instantaneous — a click would be — but clearly moving.
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(0.1);
    // 5 ms attack: fully open well inside 50 ms.
    gate.process(block(1, 2400), new Float32Array(2400));
    expect(gate.gain).toBe(1);

    gate.setOpen(false);
    gate.process(block(1), out);
    expect(out[127]).toBeLessThan(1);
    expect(out[127]).toBeGreaterThan(0.5);
    // 50 ms release: fully shut well inside 500 ms.
    gate.process(block(1, 24_000), new Float32Array(24_000));
    expect(gate.gain).toBe(0);
  });

  it("passes everything, still delayed, when disabled", () => {
    const gate = new GateSmoother({ sampleRate: SAMPLE_RATE, lookaheadMs: 1 });
    gate.setEnabled(false);
    gate.reset();
    expect(gate.gain).toBe(1);
    const out = new Float32Array(96);
    gate.process(block(0.5, 96), out);
    expect(out[47]).toBe(0);
    expect(out[48]).toBeCloseTo(0.5, 5);
  });

  it("can run in place over the same buffer", () => {
    const gate = new GateSmoother({ sampleRate: SAMPLE_RATE, lookaheadMs: 0 });
    gate.setEnabled(false);
    gate.reset();
    const buffer = block(0.25);
    gate.process(buffer, buffer);
    expect(buffer[0]).toBeCloseTo(0.25, 5);
  });

  it("has defaults that reach past the detector's onset confirmation", () => {
    // Three 10 ms attack frames plus one frame of slack: the first syllable is
    // still in the delay line when the gate decides to open.
    expect(GATE_DEFAULTS.lookaheadMs).toBeGreaterThanOrEqual(
      VAD_DEFAULTS.attackFrames * VAD_DEFAULTS.frameMs,
    );
  });
});

/** Frames cut from one continuous sine, so no phase jump at a frame edge. */
function continuousTone(hz: number, amplitude: number, frames: number): Float32Array[] {
  const whole = tone(amplitude, FRAME * frames, hz);
  return Array.from({ length: frames }, (_, i) =>
    whole.subarray(i * FRAME, (i + 1) * FRAME),
  );
}

describe("voicing", () => {
  it("analyses at 8 kHz over the pitch range of a human voice", () => {
    const voicing = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    expect(voicing.decimation).toBe(6);
    expect(voicing.lagMin).toBe(20); // 400 Hz
    expect(voicing.lagMax).toBe(133); // 60 Hz
  });

  it("hears a pitch in a sustained tone and none in noise, a click or silence", () => {
    const voiced = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    for (const frame of continuousTone(140, 0.3, 8)) voiced.push(frame);
    expect(voiced.peak()).toBeGreaterThan(0.9);

    const noisy = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    let worst = 0;
    for (let i = 0; i < 40; i += 1) {
      noisy.push(noise(0.3, FRAME, i + 1));
      if (i > 5) worst = Math.max(worst, noisy.peak());
    }
    expect(worst).toBeLessThan(VAD_DEFAULTS.voicingOn);

    const clicky = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    for (let i = 0; i < 8; i += 1) clicky.push(i % 2 === 0 ? clickFrame() : noise(0.01, FRAME, i));
    expect(clicky.peak()).toBeLessThan(VAD_DEFAULTS.voicingOn);

    const silent = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    for (let i = 0; i < 8; i += 1) silent.push(new Float32Array(FRAME));
    expect(silent.peak()).toBe(0);
  });

  it("still hears the pitch through broadband noise at 0 dB SNR", () => {
    const voicing = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    const frames = continuousTone(180, 0.3, 8);
    for (let i = 0; i < frames.length; i += 1) {
      const mixed = noise(0.3 * Math.SQRT1_2, FRAME, i + 11);
      const clean = frames[i] ?? new Float32Array(FRAME);
      for (let k = 0; k < FRAME; k += 1) mixed[k] = (mixed[k] ?? 0) + (clean[k] ?? 0);
      voicing.push(mixed);
    }
    expect(voicing.peak()).toBeGreaterThan(VAD_DEFAULTS.voicingOn);
  });

  it("forgets its history on reset", () => {
    const voicing = new VoicingDetector({ sampleRate: SAMPLE_RATE });
    for (const frame of continuousTone(140, 0.3, 8)) voicing.push(frame);
    voicing.reset();
    expect(voicing.peak()).toBe(0);
  });
});

describe("speech gate: pitch, not loudness", () => {
  /** The near-silent floor a neural suppressor leaves between words. */
  function suppressedRoom(detector: AdaptiveVad) {
    feed(detector, (i) => noise(0.0002, FRAME, i + 1), 200);
  }

  it("never opens for loud broadband crunching, however long it lasts", () => {
    const detector = vad();
    suppressedRoom(detector);
    // Bursts of crisps: 200 ms on, 200 ms off, for three seconds, at speech level.
    for (let i = 0; i < 300; i += 1) {
      const chewing = Math.floor(i / 20) % 2 === 0;
      const result = detector.processFrame(
        chewing ? noise(0.2, FRAME, i + 3) : noise(0.0002, FRAME, i + 900),
      );
      expect(result.speaking).toBe(false);
    }
  });

  it("opens for a vowel at the same energy that a crunch is refused at", () => {
    const voiced = vad();
    suppressedRoom(voiced);
    const frames = continuousTone(120, 0.05, 6);
    for (const frame of frames) voiced.processFrame(frame);
    expect(voiced.speaking).toBe(true);

    const unvoiced = vad();
    suppressedRoom(unvoiced);
    feed(unvoiced, (i) => noise(0.05, FRAME, i + 3), 6);
    expect(unvoiced.speaking).toBe(false);
  });

  it("reports the frame's voicing and the decision it fed", () => {
    const detector = vad();
    suppressedRoom(detector);
    let last = detector.processFrame(new Float32Array(FRAME));
    for (const frame of continuousTone(120, 0.05, 6)) last = detector.processFrame(frame);
    expect(last.voicing).toBeGreaterThan(VAD_DEFAULTS.voicingOn);
    expect(last.voiced).toBe(true);
    expect(last.peak).toBeCloseTo(0.05, 2);
  });

  it("opens on a word that begins with an unvoiced consonant", () => {
    const detector = vad();
    suppressedRoom(detector);
    // 80 ms of "sz", then the vowel.
    feed(detector, (i) => noise(0.05, FRAME, i + 5), 8);
    expect(detector.speaking).toBe(false);
    const frames = continuousTone(120, 0.05, 4);
    for (const frame of frames) detector.processFrame(frame);
    expect(detector.speaking).toBe(true);
  });

  it("closes once speech has turned into crunching, whatever the hangover says", () => {
    const detector = vad();
    suppressedRoom(detector);
    for (const frame of continuousTone(120, 0.1, 30)) detector.processFrame(frame);
    expect(detector.speaking).toBe(true);

    // The hangover carries the first crunches, as it must carry a trailing "s".
    feed(detector, (i) => noise(0.2, FRAME, i + 3), 20);
    expect(detector.speaking).toBe(true);
    // ...but not a whole bag of them.
    feed(detector, (i) => noise(0.2, FRAME, i + 300), VAD_DEFAULTS.maxUnvoicedFrames);
    expect(detector.speaking).toBe(false);
    // And nothing voiceless reopens it afterwards.
    feed(detector, (i) => noise(0.2, FRAME, i + 600), 50);
    expect(detector.speaking).toBe(false);
  });

  it("lets a whisper through at the top of the dial, where pitch is not required", () => {
    const whisper = vad({ ...sensitivityToThresholds(100) });
    suppressedRoom(whisper);
    feed(whisper, (i) => noise(0.05, FRAME, i + 3), 6);
    expect(whisper.speaking).toBe(true);
  });

  it("requires pitch at every ordinary sensitivity and releases it only near the top", () => {
    expect(sensitivityToThresholds(0).voicingOn).toBe(VAD_DEFAULTS.voicingOn);
    expect(sensitivityToThresholds(60).voicingOn).toBe(VAD_DEFAULTS.voicingOn);
    expect(sensitivityToThresholds(70).voicingOn).toBe(VAD_DEFAULTS.voicingOn);
    expect(sensitivityToThresholds(100).voicingOn).toBe(0);
    let previous = sensitivityToThresholds(0).voicingOn;
    for (let value = 5; value <= 100; value += 5) {
      const next = sensitivityToThresholds(value).voicingOn;
      expect(next).toBeLessThanOrEqual(previous);
      previous = next;
    }
  });

  it("can be reconfigured in place and ignores nonsense", () => {
    const detector = vad();
    detector.configure({ voicingOn: 5, maxUnvoicedFrames: 0.2, voicedHoldFrames: Number.NaN });
    expect(detector.config.voicingOn).toBe(1);
    expect(detector.config.maxUnvoicedFrames).toBe(1);
    expect(detector.config.voicedHoldFrames).toBe(VAD_DEFAULTS.voicedHoldFrames);
  });

  it("delays the gate far enough to keep the consonant before the first vowel", () => {
    // "sz", "s", "f" run 50–80 ms before the vowel that opens the gate.
    expect(GATE_DEFAULTS.lookaheadMs).toBeGreaterThanOrEqual(60);
  });
});

describe("leveller", () => {
  const quietVowel = { dbfs: -40, voiced: true, peak: 0.02 };
  const loudVowel = { dbfs: -5, voiced: true, peak: 0.8 };
  const roomNoise = { dbfs: -12, voiced: false, peak: 0.4 };

  function heard(leveller: Leveller, frame: { dbfs: number; voiced: boolean; peak: number }, frames: number) {
    for (let i = 0; i < frames; i += 1) leveller.observe(frame);
  }

  it("lifts quiet voiced speech towards the target, up to the boost limit", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, quietVowel, LEVELLER_DEFAULTS.minVoicedFrames);
    // -40 dBFS wants +20 dB to reach -20; the limit is +18.
    expect(20 * Math.log10(leveller.target)).toBeCloseTo(LEVELLER_DEFAULTS.maxBoostDb, 5);
  });

  it("learns nothing from anything that is not a vowel", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, roomNoise, 200);
    expect(leveller.target).toBe(1);
    expect(leveller.speechDb).toBeNull();

    // Nor does a chew between two sentences move a level already learned.
    heard(leveller, quietVowel, 40);
    const learned = leveller.target;
    heard(leveller, roomNoise, 200);
    expect(leveller.target).toBe(learned);
  });

  it("waits for a run of vowels before its first move", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, quietVowel, LEVELLER_DEFAULTS.minVoicedFrames - 1);
    expect(leveller.target).toBe(1);
  });

  it("pulls a loud talker down, but only by the cut limit", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, loudVowel, 40);
    expect(20 * Math.log10(leveller.target)).toBeCloseTo(-LEVELLER_DEFAULTS.maxCutDb, 5);
  });

  it("ramps a few decibels a second rather than jumping", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, quietVowel, 40);
    const input = new Float32Array(SAMPLE_RATE).fill(0.1); // one second
    const output = new Float32Array(SAMPLE_RATE);
    leveller.process(input, output);
    const gainDbAfterOneSecond = 20 * Math.log10(leveller.gain);
    expect(gainDbAfterOneSecond).toBeGreaterThan(LEVELLER_DEFAULTS.riseDbPerSecond - 0.5);
    expect(gainDbAfterOneSecond).toBeLessThan(LEVELLER_DEFAULTS.riseDbPerSecond + 0.5);
    // The first sample is barely touched; the last carries the whole ramp.
    expect(output[0]).toBeCloseTo(0.1, 3);
    expect(output[SAMPLE_RATE - 1]).toBeCloseTo(0.1 * leveller.gain, 5);
  });

  it("never lets a boosted peak clip, even before the ramp could react", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, quietVowel, 40);
    leveller.gain = 4; // +12 dB already applied
    leveller.observe({ dbfs: -8, voiced: false, peak: 0.5 });
    expect(leveller.gain * 0.5).toBeLessThanOrEqual(LEVELLER_DEFAULTS.peakCeiling);
  });

  it("returns to unity when disabled, and resets cleanly", () => {
    const leveller = new Leveller({ sampleRate: SAMPLE_RATE });
    heard(leveller, quietVowel, 40);
    expect(leveller.target).toBeGreaterThan(1);
    leveller.setEnabled(false);
    expect(leveller.target).toBe(1);
    heard(leveller, quietVowel, 40);
    expect(leveller.target).toBe(1);
    leveller.reset();
    expect(leveller.gain).toBe(1);
    expect(leveller.speechDb).toBeNull();
  });
});
