/**
 * Stellarr adaptive voice activity detection.
 *
 * Loaded by `AudioWorklet.addModule("/audio/vad-processor.js")`, which parses it
 * as a *module* script — so the `export`s below are legal, and the same file is
 * imported directly by `src/lib/voice/vad.ts` (for the no-AudioWorklet fallback)
 * and by the unit tests. One implementation, three consumers, no duplication.
 *
 * Why not a fixed RMS threshold: a fixed threshold is wrong in every room. A
 * quiet room with a hot gain stage trips it constantly; a laptop fan or an open
 * window sits just under it and the indicator never fires. This tracks the noise
 * floor continuously and decides on *signal-to-noise ratio* instead, so the same
 * constants work in a silent bedroom and next to a fan.
 *
 * Everything here runs on the audio render thread, so it allocates nothing per
 * frame and never touches a timer.
 */

/** @typedef {{ speaking: boolean, level: number, dbfs: number, noiseFloorDb: number, snrDb: number, transient: boolean }} VadFrameResult */

export const VAD_DEFAULTS = Object.freeze({
  /** Analysis frame length. 10 ms divides evenly into 48 kHz (480 samples). */
  frameMs: 10,
  sampleRate: 48000,
  /** SNR needed to *start* speaking, in dB above the tracked noise floor. */
  snrOnDb: 7.5,
  /** Lower bar to *keep* speaking — hysteresis, so syllables do not chop. */
  snrOffDb: 3.5,
  /** Nothing below this is speech no matter how good the SNR looks. */
  absoluteFloorDb: -68,
  /** Three frames reject clicks and keyboard taps while keeping onset under 30 ms. */
  attackFrames: 3,
  /** A sudden rise this far above the previous frame may be a mechanical hit. */
  transientRiseDb: 9,
  /** Peak-to-RMS ratio that separates a short impact from sustained voice. */
  transientCrestDb: 10.5,
  /** Ignore this many onset frames after an impact; speech then opens normally. */
  transientBlockFrames: 5,
  /** A click after this much quiet closes a gate still held by hangover. */
  transientReleaseQuietFrames: 8,
  /** Frames of silence tolerated before release. 45 frames = 450 ms hangover. */
  hangoverFrames: 45,
  /**
   * Periodicity a frame needs before it may *open* the detector, 0..1.
   *
   * Energy and SNR cannot tell a vowel from a crunch: a mouthful of crisps at
   * a headset microphone is as loud as speech and lasts as long. What a vowel
   * has and a crunch has not is a pitch — the vocal folds repeat, so the
   * waveform correlates with itself one period ago. See `VoicingDetector`.
   * Unvoiced consonants (s, f, sz) have no pitch either, which is why this
   * gates only the *onset*: once open, the ordinary hangover carries the
   * detector across them to the next vowel. 0 disables the check.
   */
  voicingOn: 0.6,
  /** A voiced frame keeps counting towards an onset for this many frames. */
  voicedHoldFrames: 8,
  /**
   * Once open, close after this many frames without a voiced one, however
   * loud the input still is. Speech does not go 600 ms making sound without
   * a single vowel; chewing after the last word can go on for minutes, and
   * every crunch would otherwise renew the hangover.
   */
  maxUnvoicedFrames: 60,
  /** The floor follows a drop quickly and a rise slowly, so speech cannot raise it. */
  noiseDownAlpha: 0.35,
  noiseUpAlpha: 0.025,
  /**
   * Upward tracking while speech is held. Much slower than `noiseUpAlpha`,
   * so an utterance cannot drag the floor up behind itself, but a room that
   * genuinely gets louder mid-sentence still recovers instead of latching on
   * forever.
   */
  noiseUpAlphaActive: 0.00008,
  /**
   * A steady fan has low frame-to-frame modulation. If it has held the
   * detector open long enough, learn it quickly instead of showing a speaking
   * ring for minutes. Modulated speech keeps the conservative active alpha.
   */
  noiseUpAlphaStationary: 0.08,
  stationaryAfterFrames: 90,
  stationaryDeltaDb: 0.55,
  /**
   * Learn the room before judging it. The floor starts far below any real room,
   * so without this the first frame looks like a 25 dB SNR event, fires, and
   * then freezes the floor at its initial value — latched on for the whole call.
   * 12 frames is 120 ms: long enough for an initial estimate without making
   * the speaking indicator feel as though it missed the first word.
   */
  warmupFrames: 12,
  noiseWarmupAlpha: 0.45,
  noiseFloorInitDb: -70,
  noiseFloorMinDb: -90,
  /** Digital zero is ignored, but quiet real microphone noise still teaches the floor. */
  trackingFloorDb: -96,
  /**
   * Ceiling on the estimate. It has to sit above the noise of a genuinely loud
   * room (a fan or traffic reaches roughly -25 dBFS on a laptop mic) so the
   * detector can still release there, but below conversational speech (about
   * -20 to -10 dBFS) so a noisy room can never make it deaf to talking.
   */
  noiseFloorMaxDb: -20,
  /** dBFS window mapped onto the 0..1 level the UI meter draws. */
  levelMinDb: -60,
  levelMaxDb: -12,
  levelAttack: 0.6,
  levelRelease: 0.15,
});

const SILENCE_FLOOR = 1e-9;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Mean-square energy of a frame, clipping- and NaN-safe.
 *
 * Samples are nominally -1..1 but a hot input or a badly behaved driver can
 * exceed that, and a torn buffer can contain NaN. Squaring either without
 * guarding poisons the running average permanently, so both are clamped away
 * before they reach the accumulator.
 */
export function frameMeanSquare(frame, length = frame.length) {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    let sample = frame[i];
    if (!Number.isFinite(sample)) sample = 0;
    else if (sample > 1) sample = 1;
    else if (sample < -1) sample = -1;
    sum += sample * sample;
  }
  return length > 0 ? sum / length : 0;
}

/** Largest absolute sample in a frame, with the same corruption guards as RMS. */
export function framePeakAbs(frame, length = frame.length) {
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    let sample = frame[i];
    if (!Number.isFinite(sample)) sample = 0;
    const absolute = Math.min(1, Math.abs(sample));
    if (absolute > peak) peak = absolute;
  }
  return peak;
}

/** Full-scale decibels of a mean-square energy, floored so it never returns -Infinity. */
export function meanSquareToDbfs(meanSquare) {
  return 10 * Math.log10(Math.max(meanSquare, SILENCE_FLOOR * SILENCE_FLOOR));
}

// ---- voicing ----

export const VOICING_DEFAULTS = Object.freeze({
  /**
   * Pitch lives below 400 Hz, so the search runs on an 8 kHz copy of the
   * input: six times fewer samples per lag, and the correlation of a 20 ms
   * window over 114 lags costs about 18 000 multiplies per 10 ms frame.
   */
  analysisRate: 8000,
  /**
   * 30 ms holds nearly two periods of the deepest voice and a dozen of the
   * highest. Longer windows push the chance peak of noise down (white noise
   * reaches 0.3, a ringing resonance about 0.55) while a vowel still
   * registers on its second frame, because the window is normalised and the
   * vowel dominates it as soon as it fills a third.
   */
  windowMs: 30,
  /** Range of the human voice; both children and bass singers fit. */
  minPitchHz: 60,
  maxPitchHz: 400,
  /** Anti-alias cut-off before decimation, kept clear of the analysis Nyquist. */
  lowpassHz: 3200,
});

/** Second-order section in transposed direct form II; allocates nothing per sample. */
class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
    this.z1 = 0;
    this.z2 = 0;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** RBJ cookbook low-pass, normalised so the section can be applied directly. */
function lowpassBiquad(sampleRate, cutoffHz, q) {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return new Biquad(
    (1 - cosW) / 2 / a0,
    (1 - cosW) / a0,
    (1 - cosW) / 2 / a0,
    (-2 * cosW) / a0,
    (1 - alpha) / a0,
  );
}

/**
 * How periodic the last 20 ms were, as the peak normalised autocorrelation
 * over the pitch range — 1 for a pure vowel or a tone, near 0 for noise.
 *
 * Chewing, breathing, a keyboard, a plastic bag: all of these are loud and
 * all of them last, so an energy detector opens for them. None of them repeat
 * themselves 60–400 times a second. A vowel does — that is what pitch is — so
 * a window that matches its own past one period ago is the one feature that
 * says "voice" and not merely "sound". Unvoiced consonants fail the test too,
 * which is fine: they never travel alone, and the detector's hangover carries
 * them once a vowel has opened it.
 *
 * `push` is called for every frame and does nothing but filter and decimate;
 * `peak` runs the correlation search only when the caller asks, which the
 * detector does solely for frames that already cleared the energy test.
 */
export class VoicingDetector {
  /** @param {{ sampleRate?: number, analysisRate?: number, windowMs?: number, minPitchHz?: number, maxPitchHz?: number, lowpassHz?: number }} [options] */
  constructor(options = {}) {
    const config = { ...VOICING_DEFAULTS, ...options };
    const sampleRate =
      Number.isFinite(config.sampleRate) && config.sampleRate > 0
        ? config.sampleRate
        : 48000;
    this.decimation = Math.max(1, Math.round(sampleRate / config.analysisRate));
    const rate = sampleRate / this.decimation;
    this.window = Math.max(8, Math.round((rate * config.windowMs) / 1000));
    this.lagMin = Math.max(1, Math.round(rate / config.maxPitchHz));
    this.lagMax = Math.max(this.lagMin + 1, Math.round(rate / config.minPitchHz));
    this.size = this.window + this.lagMax;
    this.ring = new Float32Array(this.size);
    this.linear = new Float32Array(this.size);
    // Float64 for the running sums: a Float32 prefix over hundreds of
    // squares drifts enough to make a quiet window's energy go negative.
    this.prefix = new Float64Array(this.size + 1);
    const cutoff = Math.min(config.lowpassHz, rate * 0.45);
    // Fourth-order Butterworth as two sections; 34 dB down at the analysis
    // Nyquist, which is plenty for a periodicity estimate.
    this.stages = [
      lowpassBiquad(sampleRate, cutoff, 0.5412),
      lowpassBiquad(sampleRate, cutoff, 1.3066),
    ];
    this.reset();
  }

  reset() {
    this.ring.fill(0);
    this.position = 0;
    this.filled = 0;
    this.phase = 0;
    for (const stage of this.stages) stage.reset();
  }

  /**
   * Filter and decimate one chunk into the history. Cheap; call it for
   * every frame so the window is always current when `peak` is wanted.
   * @param {Float32Array} frame
   * @param {number} [length]
   */
  push(frame, length = frame.length) {
    const [first, second] = this.stages;
    for (let i = 0; i < length; i += 1) {
      let sample = frame[i];
      if (!Number.isFinite(sample)) sample = 0;
      else if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      const filtered = second.process(first.process(sample));
      if (this.phase === 0) {
        this.ring[this.position] = filtered;
        this.position += 1;
        if (this.position === this.size) this.position = 0;
        if (this.filled < this.size) this.filled += 1;
      }
      this.phase += 1;
      if (this.phase === this.decimation) this.phase = 0;
    }
  }

  /**
   * Peak normalised autocorrelation of the newest window against its own
   * past, over the pitch lags. 0 until enough history exists or when the
   * window is silent.
   * @returns {number} 0..1
   */
  peak() {
    if (this.filled < this.size) return 0;
    const size = this.size;
    const x = this.linear;
    const ring = this.ring;
    // Unroll the ring oldest-first so every window is a contiguous slice.
    let position = this.position;
    for (let i = 0; i < size; i += 1) {
      x[i] = ring[position];
      position += 1;
      if (position === size) position = 0;
    }
    const prefix = this.prefix;
    prefix[0] = 0;
    for (let i = 0; i < size; i += 1) prefix[i + 1] = prefix[i] + x[i] * x[i];

    const window = this.window;
    const start = size - window;
    const energy = prefix[size] - prefix[start];
    if (energy < VOICING_SILENCE) return 0;

    let best = 0;
    for (let lag = this.lagMin; lag <= this.lagMax; lag += 1) {
      const from = start - lag;
      const lagged = prefix[size - lag] - prefix[from];
      if (lagged < VOICING_SILENCE) continue;
      let dot = 0;
      for (let i = 0; i < window; i += 1) dot += x[start + i] * x[from + i];
      const r = dot / Math.sqrt(energy * lagged);
      if (r > best) best = r;
    }
    return best > 1 ? 1 : best;
  }
}

/** Window energy under which periodicity is meaningless (about -95 dBFS). */
const VOICING_SILENCE = 1e-9;

export class AdaptiveVad {
  /** @param {Partial<typeof VAD_DEFAULTS>} [options] */
  constructor(options = {}) {
    /** @type {typeof VAD_DEFAULTS} */
    this.config = { ...VAD_DEFAULTS, ...options };
    this.frameSize = Math.max(
      1,
      Math.round((this.config.sampleRate * this.config.frameMs) / 1000),
    );
    this.frame = new Float32Array(this.frameSize);
    this.filled = 0;
    this.voicing = new VoicingDetector({ sampleRate: this.config.sampleRate });
    this.reset();
  }

  reset() {
    this.filled = 0;
    this.speaking = false;
    this.level = 0;
    this.attackCount = 0;
    this.hangoverCount = 0;
    this.transientBlockCount = 0;
    this.quietFrames = 0;
    this.framesSeen = 0;
    this.noiseFloorDb = this.config.noiseFloorInitDb;
    this.previousDbfs = this.config.noiseFloorInitDb;
    this.smoothedDb = this.config.noiseFloorInitDb;
    this.modulationDb = 0;
    this.stationaryFrames = 0;
    this.voicedHold = 0;
    this.framesSinceVoiced = 0;
    this.voicing.reset();
  }

  /**
   * Change thresholds without losing state.
   *
   * Only the fields present are touched, and each is validated here rather than
   * trusted from the message, because a NaN threshold would silently disable
   * detection for the rest of the call.
   */
  configure(patch) {
    const next = { ...this.config };
    for (const key of [
      "snrOnDb",
      "snrOffDb",
      "absoluteFloorDb",
      "attackFrames",
      "hangoverFrames",
      "transientRiseDb",
      "transientCrestDb",
      "transientBlockFrames",
      "transientReleaseQuietFrames",
      "voicingOn",
      "voicedHoldFrames",
      "maxUnvoicedFrames",
    ]) {
      const value = patch[key];
      if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
    }
    // Keep the hysteresis ordering no matter what was asked for.
    if (next.snrOffDb >= next.snrOnDb) next.snrOffDb = next.snrOnDb - 1;
    next.attackFrames = Math.max(1, Math.round(next.attackFrames));
    next.hangoverFrames = Math.max(1, Math.round(next.hangoverFrames));
    next.transientBlockFrames = Math.max(0, Math.round(next.transientBlockFrames));
    next.transientReleaseQuietFrames = Math.max(
      0,
      Math.round(next.transientReleaseQuietFrames),
    );
    next.voicingOn = clamp(next.voicingOn, 0, 1);
    next.voicedHoldFrames = Math.max(1, Math.round(next.voicedHoldFrames));
    next.maxUnvoicedFrames = Math.max(1, Math.round(next.maxUnvoicedFrames));
    this.config = next;
    // A tightened hangover must not leave a longer countdown running.
    if (this.hangoverCount > next.hangoverFrames) {
      this.hangoverCount = next.hangoverFrames;
    }
  }

  /** True while the floor is still converging and detection is suppressed. */
  get warmingUp() {
    return this.framesSeen < this.config.warmupFrames;
  }

  /**
   * Feed an arbitrary chunk (a 128-sample render quantum, say) and get back one
   * result per *completed* 10 ms frame — usually zero or one, never partial.
   *
   * @param {Float32Array} chunk
   * @param {VadFrameResult[]} [out] reused array, so the hot path allocates nothing
   * @returns {VadFrameResult[]}
   */
  push(chunk, out = []) {
    out.length = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      this.frame[this.filled] = chunk[i];
      this.filled += 1;
      if (this.filled === this.frameSize) {
        this.filled = 0;
        out.push(this.processFrame(this.frame));
      }
    }
    return out;
  }

  /**
   * Advance the state machine by exactly one frame.
   * @param {Float32Array} frame
   * @returns {VadFrameResult}
   */
  processFrame(frame) {
    const c = this.config;
    const meanSquare = frameMeanSquare(frame, this.frameSize);
    const dbfs = meanSquareToDbfs(meanSquare);
    const rms = Math.sqrt(Math.max(meanSquare, SILENCE_FLOOR * SILENCE_FLOOR));
    const peak = framePeakAbs(frame, this.frameSize);
    const crestDb = 20 * Math.log10(Math.max(peak / rms, 1));
    const warming = this.warmingUp;
    if (warming) this.framesSeen += 1;

    // Frames with no signal at all carry no information about the noise floor,
    // and letting them drag it down is actively harmful: a muted peer sends
    // digital silence, which would pull the floor to its minimum and make the
    // first frame after unmute look like a huge SNR event — a phantom
    // "speaking" flash every time someone unmutes.
    const informative = dbfs > c.trackingFloorDb;

    // A cheap modulation estimate separates steady machinery from speech. It
    // is deliberately used only to recover a detector that is already held
    // open (or held at the brink by continuous unvoiced energy); onset still
    // depends solely on level, SNR and voicing.
    const held = this.speaking || this.attackCount > 0;
    if (informative) {
      const delta = Math.abs(dbfs - this.smoothedDb);
      this.smoothedDb += (dbfs - this.smoothedDb) * 0.12;
      this.modulationDb += (delta - this.modulationDb) * 0.08;
      if (held && this.modulationDb <= c.stationaryDeltaDb) {
        this.stationaryFrames += 1;
      } else {
        this.stationaryFrames = 0;
      }
    } else {
      this.stationaryFrames = 0;
    }

    if (!informative) {
      // Leave the floor where it is.
    } else if (warming) {
      // Converge hard on whatever the room is actually doing.
      this.noiseFloorDb += (dbfs - this.noiseFloorDb) * c.noiseWarmupAlpha;
    } else if (dbfs < this.noiseFloorDb) {
      // Drops are tracked fast: the floor should sit on the quiet moments.
      this.noiseFloorDb += (dbfs - this.noiseFloorDb) * c.noiseDownAlpha;
    } else {
      // Rises are tracked slowly, and slower still while speech is held, so an
      // utterance cannot teach the detector to ignore itself.
      const alpha =
        this.stationaryFrames >= c.stationaryAfterFrames
          ? c.noiseUpAlphaStationary
          : held
            ? c.noiseUpAlphaActive
            : c.noiseUpAlpha;
      this.noiseFloorDb += (dbfs - this.noiseFloorDb) * alpha;
    }
    this.noiseFloorDb = clamp(this.noiseFloorDb, c.noiseFloorMinDb, c.noiseFloorMaxDb);

    const snrDb = dbfs - this.noiseFloorDb;
    const threshold = this.speaking ? c.snrOffDb : c.snrOnDb;
    const energyActive =
      !warming && dbfs > c.absoluteFloorDb && snrDb >= threshold;

    // Keyboard switches and controller buttons are impulsive: a large crest
    // arriving in one frame after a quieter frame. Energy/SNR alone cannot
    // distinguish a row of those impacts from speech. A voiced vowel or a
    // sustained consonant has a far lower peak-to-RMS ratio, so it proceeds
    // through the ordinary attack counter. The short block is deliberately
    // bounded; if an impact is immediately followed by real speech, the voice
    // still opens after at most 50 ms plus the normal attack.
    const transient =
      !warming &&
      dbfs > c.absoluteFloorDb &&
      dbfs - this.previousDbfs >= c.transientRiseDb &&
      crestDb >= c.transientCrestDb;
    const quietBeforeFrame = this.quietFrames;
    if (energyActive && !transient) this.quietFrames = 0;
    else this.quietFrames += 1;

    if (transient) {
      this.transientBlockCount = Math.max(
        this.transientBlockCount,
        c.transientBlockFrames,
      );
      this.attackCount = 0;
      // Hangover intentionally keeps natural gaps between words open. Once a
      // gap is clearly established, however, a mechanical impact must not use
      // that old speech window to become audible.
      if (
        this.speaking &&
        quietBeforeFrame >= c.transientReleaseQuietFrames
      ) {
        this.speaking = false;
        this.hangoverCount = 0;
      }
    }

    const transientBlocked = this.transientBlockCount > 0;
    if (transientBlocked) this.transientBlockCount -= 1;
    const active = energyActive && !transientBlocked;
    this.previousDbfs = dbfs;

    // Periodicity is measured only for frames that already cleared the energy
    // test, or while the detector is open and needs to know whether the sound
    // it is passing still has a voice in it. The history is kept current for
    // every frame regardless, so the answer is available the moment it counts.
    this.voicing.push(frame, this.frameSize);
    const voicingWanted = c.voicingOn > 0 && (energyActive || this.speaking);
    const voicing = voicingWanted ? this.voicing.peak() : 0;
    const voiced = energyActive && !transient && voicing >= c.voicingOn;
    if (voiced) {
      this.voicedHold = c.voicedHoldFrames;
      this.framesSinceVoiced = 0;
    } else {
      if (this.voicedHold > 0) this.voicedHold -= 1;
      this.framesSinceVoiced += 1;
    }

    if (active) {
      this.hangoverCount = c.hangoverFrames;
      if (!this.speaking) {
        // Capped, so a long unvoiced run (a fan, a bag of crisps) waits at the
        // brink rather than counting up forever; the first vowel opens it.
        this.attackCount = Math.min(this.attackCount + 1, c.attackFrames);
        if (
          this.attackCount >= c.attackFrames &&
          (c.voicingOn <= 0 || this.voicedHold > 0)
        ) {
          this.speaking = true;
          this.attackCount = 0;
        }
      }
    } else {
      this.attackCount = 0;
      if (this.speaking) {
        this.hangoverCount -= 1;
        if (this.hangoverCount <= 0) this.speaking = false;
      }
    }
    // Loud but voiceless for too long: the sentence has ended and something
    // else is being fed to the microphone. Close, whatever the hangover says.
    if (
      this.speaking &&
      c.voicingOn > 0 &&
      this.framesSinceVoiced > c.maxUnvoicedFrames
    ) {
      this.speaking = false;
      this.hangoverCount = 0;
    }

    const target = clamp(
      (dbfs - c.levelMinDb) / (c.levelMaxDb - c.levelMinDb),
      0,
      1,
    );
    const alpha = target > this.level ? c.levelAttack : c.levelRelease;
    this.level += (target - this.level) * alpha;

    return {
      speaking: this.speaking,
      level: this.level,
      dbfs,
      peak,
      noiseFloorDb: this.noiseFloorDb,
      snrDb,
      transient,
      voicing,
      voiced,
    };
  }
}

/**
 * Maps a 0..100 sensitivity dial onto SNR thresholds.
 *
 * Sensitivity is the only VAD control worth exposing: everything else is a
 * consequence of it. 0 means "only clear speech above the room", 100 means "a
 * whisper counts". The on-threshold sweeps 14 dB down to 3 dB above the tracked
 * noise floor; the off-threshold trails it so hysteresis survives at both ends,
 * and the hangover grows slightly at high sensitivity so a quiet talker is not
 * chopped between words.
 */
export function sensitivityToThresholds(sensitivity) {
  const value = Number.isFinite(sensitivity) ? clamp(sensitivity, 0, 100) : 50;
  const t = value / 100;
  const snrOnDb = round1(14 - t * 11);
  return {
    snrOnDb,
    // Always meaningfully below the on-threshold, never below ~1.5 dB where
    // noise alone would hold the gate open.
    snrOffDb: round1(Math.max(1.5, snrOnDb - (3 + t * 2))),
    hangoverFrames: Math.round(25 + t * 20),
    // SNR alone is blind after a neural suppressor: RNNoise leaves near-digital
    // silence between words, so a -45 dBFS chewing residue over a -85 dBFS
    // floor is a 40 dB "event". The absolute floor gives the dial a second
    // meaning — at 0 only genuinely loud speech counts (-45 dBFS), at 100 the
    // original -68 dBFS whisper threshold applies.
    absoluteFloorDb: round1(-45 - t * 23),
    // Periodicity is required for an onset at every ordinary setting: it is
    // what keeps a crunch, a breath or a keyboard from opening the gate at
    // *any* loudness. Only the top of the dial, where the person has asked
    // for whispers — which have no pitch — lets the requirement go.
    voicingOn: Math.max(0, round2(t <= 0.7 ? 0.6 : 0.6 * (1 - (t - 0.7) / 0.3))),
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Level steps the UI meter can actually draw — 3 bars, so 8 steps is ample. */
export const LEVEL_STEPS = 8;

/**
 * Decides when a frame result is worth a `postMessage`.
 *
 * The detector produces 100 results a second; the UI can act on far fewer.
 * A speaking flip crosses the thread immediately because it changes what is on
 * screen, while level changes are quantised and rate-limited. Without this the
 * audio thread would wake the main thread 100 times a second to redraw three
 * bars that only have 8 distinct states.
 */
export class VadPublisher {
  /**
   * @param {{ minFramesBetweenLevelPosts?: number, publishSilentLevels?: boolean }} [options]
   */
  constructor(options = {}) {
    // Ten 10 ms frames cap meter traffic at 10 Hz. CSS interpolates the bars,
    // while the main thread avoids 25 updates per second for every participant.
    this.minFramesBetweenLevelPosts = options.minFramesBetweenLevelPosts ?? 10;
    this.publishSilentLevels = options.publishSilentLevels ?? true;
    this.lastSpeaking = false;
    this.lastLevelStep = -1;
    this.framesSincePost = 0;
  }

  /**
   * @param {{ speaking: boolean, level: number }} result
   * @returns {{ speaking: boolean, level: number } | null} payload to post, or null
   */
  consider(result) {
    this.framesSincePost += 1;
    const step = Math.round(clamp(result.level, 0, 1) * LEVEL_STEPS);
    const speakingChanged = result.speaking !== this.lastSpeaking;
    const levelChanged =
      (this.publishSilentLevels || result.speaking) &&
      step !== this.lastLevelStep &&
      this.framesSincePost >= this.minFramesBetweenLevelPosts;

    if (!speakingChanged && !levelChanged) return null;

    this.lastSpeaking = result.speaking;
    // A remote strip does not need to redraw room noise while nobody speaks.
    // Release still publishes one explicit zero so a meter never stays raised.
    this.lastLevelStep = result.speaking || this.publishSilentLevels ? step : 0;
    this.framesSincePost = 0;
    return {
      speaking: result.speaking,
      level: this.lastLevelStep / LEVEL_STEPS,
    };
  }

  reset() {
    this.lastSpeaking = false;
    this.lastLevelStep = -1;
    this.framesSincePost = 0;
  }
}


// ---- gate ----

export const GATE_DEFAULTS = Object.freeze({
  /**
   * The detector needs `attackFrames` (30 ms) to confirm an onset, and it
   * confirms on the first *vowel*: a word that starts with "s", "sz" or "f"
   * has been making sound for 50–80 ms by then. Output is delayed by that
   * much, so opening the gate on confirmation reaches back to the consonant
   * instead of clipping it — which is the whole reason a plain VAD-as-gate
   * sounds chopped. 80 ms on top of the call's latency is audible only as a
   * fraction of the jitter buffer everyone already lives with.
   */
  lookaheadMs: 80,
  /** Fast enough to feel instant, slow enough to avoid a click. */
  attackMs: 6,
  /** Long enough that word endings fade rather than snap off. */
  releaseMs: 90,
  /** Fully closed: what the other side hears between your sentences is nothing. */
  closedGain: 0,
});

/**
 * Sample-accurate gain follower with a lookahead delay.
 *
 * Kept independent of the Web Audio graph so the tests can drive it with plain
 * arrays. It allocates once, in the constructor; `process` never allocates.
 */
export class GateSmoother {
  /** @param {{ sampleRate: number, lookaheadMs?: number, attackMs?: number, releaseMs?: number, closedGain?: number }} options */
  constructor(options) {
    const config = { ...GATE_DEFAULTS, ...options };
    const sampleRate =
      Number.isFinite(config.sampleRate) && config.sampleRate > 0
        ? config.sampleRate
        : 48000;
    this.closedGain = clamp(
      Number.isFinite(config.closedGain) ? config.closedGain : 0,
      0,
      1,
    );
    this.delaySamples = Math.max(
      0,
      Math.round((Math.max(0, config.lookaheadMs) * sampleRate) / 1000),
    );
    this.buffer = new Float32Array(Math.max(1, this.delaySamples));
    this.position = 0;
    this.attackCoefficient = coefficientFor(config.attackMs, sampleRate);
    this.releaseCoefficient = coefficientFor(config.releaseMs, sampleRate);
    this.enabled = true;
    this.open = false;
    this.gain = this.closedGain;
  }

  /** The gain the follower is heading towards right now. */
  get target() {
    return this.enabled && !this.open ? this.closedGain : 1;
  }

  /** @param {boolean} open */
  setOpen(open) {
    this.open = Boolean(open);
  }

  /**
   * A disabled gate passes everything but keeps its delay, so toggling it
   * mid-call never shifts the audio in time.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  reset() {
    this.buffer.fill(0);
    this.position = 0;
    this.gain = this.target;
  }

  /**
   * @param {Float32Array} input
   * @param {Float32Array} output may be the same array as `input`
   * @param {number} [length]
   */
  process(input, output, length = input.length) {
    const target = this.target;
    const coefficient =
      target > this.gain ? this.attackCoefficient : this.releaseCoefficient;
    let gain = this.gain;
    if (this.delaySamples === 0) {
      for (let i = 0; i < length; i += 1) {
        gain += (target - gain) * coefficient;
        output[i] = input[i] * gain;
      }
    } else {
      const buffer = this.buffer;
      const size = this.delaySamples;
      let position = this.position;
      for (let i = 0; i < length; i += 1) {
        const delayed = buffer[position];
        buffer[position] = input[i];
        position += 1;
        if (position === size) position = 0;
        gain += (target - gain) * coefficient;
        output[i] = delayed * gain;
      }
      this.position = position;
    }
    // Snap once the ramp is inaudibly close, so a closed gate is truly silent
    // rather than a denormal-speed tail of -100 dB residue.
    this.gain = Math.abs(target - gain) < 1e-4 ? target : gain;
  }
}

function coefficientFor(ms, sampleRate) {
  const samples = (Math.max(0, ms) * sampleRate) / 1000;
  if (samples < 1) return 1;
  return 1 - Math.exp(-1 / samples);
}

// ---- leveller ----

export const LEVELLER_DEFAULTS = Object.freeze({
  /** Frame RMS that voiced speech is steered towards, in dBFS. */
  targetDb: -20,
  /** Ceiling on the boost. A microphone 18 dB too quiet is a hardware problem. */
  maxBoostDb: 18,
  /** A loud talker is only pulled down gently; the listener's compressor does the rest. */
  maxCutDb: 6,
  /** How fast the speech-level estimate follows a voiced frame. ~200 ms of vowels. */
  levelAlpha: 0.05,
  /** Gain climbs slowly, so a pause can never become a swell of room noise... */
  riseDbPerSecond: 6,
  /** ...and falls quickly, so a sudden shout does not stay a shout. */
  fallDbPerSecond: 40,
  /** No boosted sample may pass this; the guard acts before the sample plays. */
  peakCeiling: 0.95,
  /** Vowel frames heard before the first move — no decision from one "hm". */
  minVoicedFrames: 10,
});

/**
 * Automatic volume that learns from vowels and nothing else.
 *
 * The platform AGC measures whatever is loud. Between sentences that is the
 * room, the keyboard, or the crisps, and it duly turns them up — which is
 * exactly the sound this whole pipeline exists to remove. This one takes its
 * level from frames the detector marked voiced, so it can only ever steer
 * the voice to the target; silence and chewing teach it nothing. The gain
 * ramps in the dB domain a few decibels a second, inaudibly, and a peak
 * guard keeps a boosted shout from clipping before the ramp could react.
 *
 * Frame decisions (`observe`) come from the detector's results; the gain is
 * applied per sample (`process`) after the gate, so a closed gate stays
 * closed and an opening one is levelled from its first sample.
 */
export class Leveller {
  /** @param {{ sampleRate: number } & Partial<typeof LEVELLER_DEFAULTS>} options */
  constructor(options) {
    const config = { ...LEVELLER_DEFAULTS, ...options };
    const sampleRate =
      Number.isFinite(config.sampleRate) && config.sampleRate > 0
        ? config.sampleRate
        : 48000;
    this.config = config;
    this.riseRatio = 10 ** (Math.max(0, config.riseDbPerSecond) / 20 / sampleRate);
    this.fallRatio = 10 ** (-Math.max(0, config.fallDbPerSecond) / 20 / sampleRate);
    this.maxGain = 10 ** (Math.max(0, config.maxBoostDb) / 20);
    this.minGain = 10 ** (-Math.max(0, config.maxCutDb) / 20);
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.gain = 1;
    this.targetGain = 1;
    this.speechDb = null;
    this.voicedFrames = 0;
  }

  /** A disabled leveller ramps back to unity rather than snapping. */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  /** The gain the ramp is heading towards right now. */
  get target() {
    return this.enabled ? this.targetGain : 1;
  }

  /**
   * Learn from one detector frame.
   * @param {{ dbfs: number, voiced: boolean, peak?: number }} result
   */
  observe(result) {
    const c = this.config;
    if (this.enabled && result.voiced) {
      this.voicedFrames += 1;
      this.speechDb =
        this.speechDb === null
          ? result.dbfs
          : this.speechDb + (result.dbfs - this.speechDb) * c.levelAlpha;
      if (this.voicedFrames >= c.minVoicedFrames) {
        const wantedDb = clamp(c.targetDb - this.speechDb, -c.maxCutDb, c.maxBoostDb);
        this.targetGain = 10 ** (wantedDb / 20);
      }
    }
    // The frame just analysed is still in the gate's delay line, so pulling
    // the gain down now lands before its loudest sample is played.
    const peak = result.peak;
    if (typeof peak === "number" && peak > 0) {
      const ceiling = Math.max(this.minGain, c.peakCeiling / peak);
      if (this.gain > ceiling) this.gain = ceiling;
    }
  }

  /**
   * @param {Float32Array} input
   * @param {Float32Array} output may be the same array as `input`
   * @param {number} [length]
   */
  process(input, output, length = input.length) {
    const target = this.target;
    const rise = this.riseRatio;
    const fall = this.fallRatio;
    let gain = this.gain;
    for (let i = 0; i < length; i += 1) {
      if (gain < target) {
        gain *= rise;
        if (gain > target) gain = target;
      } else if (gain > target) {
        gain *= fall;
        if (gain < target) gain = target;
      }
      output[i] = input[i] * gain;
    }
    this.gain = gain;
  }
}

export const VAD_PROCESSOR_NAME = "stellarr-vad";

// Only defined when this module is loaded into an AudioWorkletGlobalScope; when
// Vitest or the fallback path imports it, this block is skipped entirely.
if (
  typeof AudioWorkletProcessor !== "undefined" &&
  typeof registerProcessor === "function"
) {
  /**
   * One processor, two jobs.
   *
   * Without `gate` in the options it is the observer it always was: it
   * analyses, posts speaking/level, and outputs nothing. With `gate: true` it
   * also becomes the audible path — the input comes out the other side
   * delayed by the lookahead and multiplied by a gain that follows the very
   * same detector. Sharing one instance means the ring around your avatar and
   * the sound the others hear can never disagree.
   */
  class VadProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const processorOptions =
        options && options.processorOptions ? options.processorOptions : {};
      this.vad = new AdaptiveVad({
        sampleRate,
        ...processorOptions,
      });
      this.publisher = new VadPublisher({
        publishSilentLevels: processorOptions.publishSilentLevels !== false,
      });
      this.gate =
        processorOptions.gate === true
          ? new GateSmoother({
              sampleRate,
              ...(typeof processorOptions.lookaheadMs === "number"
                ? { lookaheadMs: processorOptions.lookaheadMs }
                : {}),
              ...(typeof processorOptions.attackMs === "number"
                ? { attackMs: processorOptions.attackMs }
                : {}),
              ...(typeof processorOptions.releaseMs === "number"
                ? { releaseMs: processorOptions.releaseMs }
                : {}),
              ...(typeof processorOptions.closedGain === "number"
                ? { closedGain: processorOptions.closedGain }
                : {}),
            })
          : null;
      if (this.gate && processorOptions.gateEnabled === false) {
        this.gate.setEnabled(false);
        this.gate.reset();
      }
      // Automatic volume rides on the same detector: it is told which frames
      // were vowels, and it is applied after the gate so the two never fight.
      this.leveller =
        processorOptions.leveller === true ? new Leveller({ sampleRate }) : null;
      if (this.leveller && processorOptions.levellerEnabled === false) {
        this.leveller.setEnabled(false);
      }
      this.results = [];
      this.alive = true;
      this.port.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "reset") {
          this.vad.reset();
          this.publisher.reset();
          this.gate?.reset();
          this.leveller?.reset();
        } else if (data.type === "stop") {
          this.alive = false;
        } else if (data.type === "config") {
          // Applied in place: rebuilding the node would drop the learned noise
          // floor and force another 400 ms warm-up mid-sentence.
          this.vad.configure(data.config || {});
        } else if (data.type === "gate") {
          this.gate?.setEnabled(data.enabled !== false);
        } else if (data.type === "leveller") {
          this.leveller?.setEnabled(data.enabled !== false);
        }
      };
    }

    process(inputs, outputs) {
      if (!this.alive) return false;
      const input = inputs[0];
      const channel = input && input[0];
      // A disconnected or not-yet-flowing source yields an empty array. Keep the
      // node alive and wait rather than treating the gap as silence.
      if (!channel || channel.length === 0) return true;

      const results = this.vad.push(channel, this.results);
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        this.leveller?.observe(result);
        const payload = this.publisher.consider(result);
        if (payload) this.port.postMessage(payload);
      }

      if (this.gate || this.leveller) {
        const output = outputs[0] && outputs[0][0];
        if (output) {
          if (this.gate) {
            // `speaking` includes the hangover, so pauses between words stay
            // open; nothing voiceless ever sets it, so a crunch stays shut.
            this.gate.setOpen(this.vad.speaking);
            this.gate.process(channel, output, channel.length);
          } else {
            output.set(channel);
          }
          if (this.leveller) this.leveller.process(output, output, channel.length);
        }
      }
      return true;
    }
  }

  registerProcessor(VAD_PROCESSOR_NAME, VadProcessor);
}
