/**
 * What a noise suppressor does to speech and to noise, measured against the
 * clean speech a mixture was made from. The suppressor comparison
 * (`main.ts`) renders each mixture through an engine and hands the output
 * here; nothing in this file knows which engine it was.
 *
 * A mixture is a clean talker, a synthetic one from `fixtures.ts` or a
 * recording from `recordings/`, set to -26 dBFS, after two seconds of the
 * room alone, with one of the rooms below mixed over the whole length. The
 * rooms are the ones the fixtures and the recordings harness already use.
 */
import { BLOCK, SAMPLE_RATE, dbToGain, mixInto, setActiveLevel } from "../dsp";
import { ROOM } from "../fixtures";

/** How long the room plays before the talker starts: time for a suppressor to learn it. */
export const LEAD_IN = 2 * SAMPLE_RATE;

/** The talker's level: the -26 dBFS of the fixtures' talkers. */
const SPEECH_DB = -26;

/** A mixture's length is rounded up to a whole number of these, 80 ms, as the fixtures are. */
const UNIT = 3840;

export interface Room {
  name: string;
  /** What it is, for the printed table. */
  label: string;
  build(samples: number): Float32Array;
}

/**
 * Steady noise at three signal-to-noise ratios, impulsive noise, and a
 * quiet room, where whatever changes is done to the speech.
 */
export const ROOMS: readonly Room[] = [
  { name: "quiet", label: "quiet room (-60 dBFS)", build: (samples) => ROOM.room(samples, -60) },
  ...[20, 10, 0].map((snr) => ({
    name: `fan${snr}`,
    label: `fan, speech ${snr} dB over it`,
    build: (samples: number) => {
      const out = ROOM.fan(samples, SPEECH_DB - snr);
      mixInto(out, ROOM.room(samples, -72));
      return out;
    },
  })),
  {
    name: "typing",
    label: "typing and breaths over a quiet room",
    build: (samples) => {
      const out = ROOM.clicksAndBreath(samples);
      mixInto(out, ROOM.room(samples, -60));
      return out;
    },
  },
];

export interface Mixture {
  /** `<talker>.<room>`, also the name of its WAV files. */
  name: string;
  talker: string;
  room: string;
  /** Whether the talker is a recording rather than the synthesiser of fixtures.ts. */
  recorded: boolean;
  clean: Float32Array;
  input: Float32Array;
}

/** Every talker in every room. */
export function mixtures(talkers: ReadonlyArray<{ name: string; samples: Float32Array; recorded: boolean }>): Mixture[] {
  const out: Mixture[] = [];
  for (const talker of talkers) {
    const length = Math.ceil((LEAD_IN + talker.samples.length) / UNIT) * UNIT;
    const clean = new Float32Array(length);
    clean.set(setActiveLevel(talker.samples.slice(), SPEECH_DB), LEAD_IN);
    for (const room of ROOMS) {
      const input = room.build(length);
      mixInto(input, clean);
      out.push({ name: `${talker.name}.${room.name}`, talker: talker.name, room: room.name, recorded: talker.recorded, clean, input });
    }
  }
  return out;
}

export interface Measures {
  /** Samples the output trails the clean talker by, found by correlation; every other measure is taken at this lag. */
  latency: number;
  /** dB the output sits below the input where the talker is silent, from 1 s in. */
  noiseReduction: number;
  /** The same, for the energy above 8 kHz alone, which a fan barely has and hiss and typing have. */
  noiseReductionAbove8k: number;
  /** The power above 8 kHz left in those stretches, in dBFS, and the input's, for scale. */
  noiseLevelAbove8k: number;
  noiseLevelInAbove8k: number;
  /** SI-SDR in dB of the output against the clean talker, aligned by the latency; of the input, for scale. */
  siSdr: number;
  siSdrInput: number;
  /** Level of the output where the talker speaks, in dB against the clean talker. */
  speech: number;
  /** Energy above 4 kHz and above 8 kHz where the talker speaks, in dB against the clean talker. */
  above4k: number;
  above8k: number;
  /** The first 50 ms of each phrase, in dB against the clean talker: the mean, and the phrase that lost most. */
  onset: number;
  onsetWorst: number;
  /** How many phrase starts the onset figures are taken over. */
  onsets: number;
  /**
   * Energy above 8 kHz in the first and in the last 43 ms (two 1024-sample
   * frames) of each phrase, in dB against the clean talker, averaged over
   * phrases: below 0 at the start is a band that opens late, below 0 at the
   * end one that closes early, above 0 at the end a hiss tail.
   */
  onsetAbove8k: number;
  offsetAbove8k: number;
}

const energy = (samples: ArrayLike<number>, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (samples[i] ?? 0) ** 2;
  return sum;
};

const db = (ratio: number) => (ratio > 0 ? 10 * Math.log10(ratio) : -Infinity);

/** In-place radix-2 FFT of `re` and `im`, whose length is a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = (re[b] as number) * wr - (im[b] as number) * wi;
        const ti = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
      }
    }
  }
}

const FFT_SIZE = 1024;

/** Energy above `cutoff` Hz in the frames of FFT_SIZE starting at each of `starts`, Hann-windowed. */
function energyAbove(samples: ArrayLike<number>, starts: readonly number[], cutoffs: readonly number[]): number[] {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const totals = cutoffs.map(() => 0);
  const firstBins = cutoffs.map((cutoff) => Math.ceil((cutoff * FFT_SIZE) / SAMPLE_RATE));
  for (const start of starts) {
    for (let i = 0; i < FFT_SIZE; i += 1) {
      re[i] = (samples[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
      im[i] = 0;
    }
    fft(re, im);
    for (let c = 0; c < cutoffs.length; c += 1) {
      let sum = 0;
      for (let bin = firstBins[c] as number; bin <= FFT_SIZE / 2; bin += 1) sum += (re[bin] as number) ** 2 + (im[bin] as number) ** 2;
      totals[c] = (totals[c] as number) + sum;
    }
  }
  return totals;
}

/** Mean-square power of a band, from `energyAbove`'s sum over `frames` Hann-windowed frames of FFT_SIZE (Parseval, one-sided). */
const bandPower = (sum: number, frames: number) => (2 * sum) / (frames * FFT_SIZE * FFT_SIZE * 0.375);

/** The furthest an output may trail its input: 100 ms. */
const MAX_LATENCY = 4800;

/**
 * How many samples `output` trails the clean talker: the lag at which the
 * loudest half second of the talker correlates best with the output. The
 * probe the comparison uses for the other engines is white noise, which a
 * suppressor removes, so it cannot say; the talker itself, the one thing
 * every suppressor passes, can.
 */
export function estimateLatency(clean: Float32Array, output: Float32Array): number {
  const span = SAMPLE_RATE / 2;
  let from = LEAD_IN;
  let loudest = -1;
  for (let start = LEAD_IN; start + span + MAX_LATENCY < clean.length; start += BLOCK * 10) {
    const value = energy(clean, start, start + span);
    if (value > loudest) {
      loudest = value;
      from = start;
    }
  }
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = 0; lag <= MAX_LATENCY; lag += 1) {
    let dot = 0;
    let power = 1e-20;
    for (let i = from; i < from + span; i += 1) {
      const y = output[i + lag] ?? 0;
      dot += y * (clean[i] as number);
      power += y * y;
    }
    const score = dot / Math.sqrt(power);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

/** The measures of one output against the clean talker its mixture was made from. */
export function measure(mixture: Mixture, output: Float32Array): Measures {
  const { clean, input } = mixture;
  const latency = estimateLatency(clean, output);
  const length = clean.length;
  const aligned = (i: number) => output[i + latency] ?? 0;
  const end = length - latency;

  // Where the talker speaks and where it is silent, in 10 ms blocks of the
  // clean talker: speaking within 30 dB of its level, silent 60 dB under it
  // with 50 ms of silence either side.
  const blocks = Math.floor(end / BLOCK);
  const level = dbToGain(SPEECH_DB) ** 2 * BLOCK;
  const blockEnergy = Array.from({ length: blocks }, (_, b) => energy(clean, b * BLOCK, (b + 1) * BLOCK));
  const speaking = blockEnergy.map((value) => value > level * dbToGain(-30) ** 2);
  const silent = blockEnergy.map((value) => value < level * dbToGain(-60) ** 2);
  const margin = 5;
  const quiet = silent.map((_, b) => {
    for (let k = b - margin; k <= b + margin; k += 1) if (k >= 0 && k < blocks && !silent[k]) return false;
    return b * BLOCK >= SAMPLE_RATE;
  });

  let noiseIn = 0;
  let noiseOut = 0;
  let speechOut = 0;
  let speechClean = 0;
  for (let b = 0; b < blocks; b += 1) {
    const from = b * BLOCK;
    if (quiet[b]) {
      noiseIn += energy(input, from, from + BLOCK);
      for (let i = from; i < from + BLOCK; i += 1) noiseOut += aligned(i) ** 2;
    }
    if (speaking[b]) {
      speechClean += blockEnergy[b] as number;
      for (let i = from; i < from + BLOCK; i += 1) speechOut += aligned(i) ** 2;
    }
  }

  // SI-SDR over everything from the talker's first sample on.
  const siSdr = (estimate: (i: number) => number) => {
    let dot = 0;
    let target = 0;
    for (let i = LEAD_IN; i < end; i += 1) {
      dot += estimate(i) * (clean[i] as number);
      target += (clean[i] as number) ** 2;
    }
    const scale = dot / target;
    let wanted = 0;
    let error = 0;
    for (let i = LEAD_IN; i < end; i += 1) {
      const projected = scale * (clean[i] as number);
      wanted += projected ** 2;
      error += (estimate(i) - projected) ** 2;
    }
    return db(wanted / error);
  };

  // The speech band, on frames of 1024 samples whose blocks all speak.
  const starts: number[] = [];
  for (let start = LEAD_IN; start + FFT_SIZE <= end; start += FFT_SIZE) {
    const first = Math.floor(start / BLOCK);
    const last = Math.floor((start + FFT_SIZE - 1) / BLOCK);
    let all = true;
    for (let b = first; b <= last && all; b += 1) all = speaking[b] === true;
    if (all) starts.push(start);
  }
  const [clean4k, clean8k] = energyAbove(clean, starts, [4000, 8000]);
  const [out4k, out8k] = energyAbove(output.subarray(latency), starts, [4000, 8000]);

  // The noise above 8 kHz, on frames of 1024 samples inside the quiet stretches.
  const quietStarts: number[] = [];
  for (let start = SAMPLE_RATE; start + FFT_SIZE <= end; start += FFT_SIZE) {
    const first = Math.floor(start / BLOCK);
    const last = Math.floor((start + FFT_SIZE - 1) / BLOCK);
    let all = true;
    for (let b = first; b <= last && all; b += 1) all = quiet[b] === true;
    if (all) quietStarts.push(start);
  }
  const [noiseIn8k] = energyAbove(input, quietStarts, [8000]);
  const [noiseOut8k] = energyAbove(output.subarray(latency), quietStarts, [8000]);

  // Phrase starts: a speaking block after at least 200 ms without one.
  const onsetLevels: number[] = [];
  const window = Math.round(0.05 * SAMPLE_RATE);
  let lastSpeaking = -Infinity;
  for (let b = 0; b < blocks; b += 1) {
    if (!speaking[b]) continue;
    if (b - lastSpeaking > 20 && (b + 1) * BLOCK + window <= end) {
      // From the first sample of the phrase, not of its block.
      let from = Math.max(0, b - 5) * BLOCK;
      while (from < (b + 1) * BLOCK && Math.abs(clean[from] as number) < dbToGain(SPEECH_DB - 40)) from += 1;
      let out = 0;
      for (let i = from; i < from + window; i += 1) out += aligned(i) ** 2;
      onsetLevels.push(db(out / energy(clean, from, from + window)));
    }
    lastSpeaking = b;
  }

  // The top band at the start and at the end of each phrase: a speaking block
  // with none in the 200 ms before it, and one with none in the 200 ms after.
  const edge = (firsts: number[]) => {
    const starts = firsts.filter((start) => start >= 0 && start + 2 * FFT_SIZE <= end).flatMap((start) => [start, start + FFT_SIZE]);
    const [cleanEdge] = energyAbove(clean, starts, [8000]);
    const [outEdge] = energyAbove(output.subarray(latency), starts, [8000]);
    return starts.length === 0 ? NaN : db((outEdge as number) / (cleanEdge as number));
  };
  const phraseStarts: number[] = [];
  const phraseEnds: number[] = [];
  for (let b = 0; b < blocks; b += 1) {
    if (!speaking[b]) continue;
    const near = (direction: 1 | -1) => Array.from({ length: 20 }, (_, k) => speaking[b + direction * (1 + k)] === true).some(Boolean);
    if (!near(-1)) phraseStarts.push(b * BLOCK);
    if (!near(1)) phraseEnds.push((b + 1) * BLOCK - 2 * FFT_SIZE);
  }

  return {
    latency,
    noiseReduction: db(noiseOut / noiseIn),
    noiseReductionAbove8k: db((noiseOut8k as number) / (noiseIn8k as number)),
    noiseLevelAbove8k: db(bandPower(noiseOut8k as number, quietStarts.length)),
    noiseLevelInAbove8k: db(bandPower(noiseIn8k as number, quietStarts.length)),
    siSdr: siSdr(aligned),
    siSdrInput: siSdr((i) => input[i] as number),
    speech: db(speechOut / speechClean),
    above4k: db((out4k as number) / (clean4k as number)),
    above8k: db((out8k as number) / (clean8k as number)),
    onset: onsetLevels.length > 0 ? onsetLevels.reduce((sum, value) => sum + value, 0) / onsetLevels.length : NaN,
    onsetWorst: onsetLevels.length > 0 ? Math.min(...onsetLevels) : NaN,
    onsets: onsetLevels.length,
    onsetAbove8k: edge(phraseStarts),
    offsetAbove8k: edge(phraseEnds),
  };
}
