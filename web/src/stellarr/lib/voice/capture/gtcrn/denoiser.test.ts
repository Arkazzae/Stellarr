/**
 * The real gtcrn.wasm, the one the browser is served (web/public/audio/,
 * which the pretest hook assembles from the recipe's output), through the
 * wrapper the worklet uses. What it does to each fixture is held exactly by
 * the suppressor record in web/bench/voice/; these say what the record
 * cannot: that the framing delays by exactly what `BUFFERING` says, that the
 * output is noise suppression at all, that samples past full scale stay finite, and that a destroyed state gives its memory back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUFFERING, FRAME, GtcrnDenoiser, QUANTUM, instantiateGtcrn, type GtcrnExports } from "./denoiser";

const RATE = 48_000;

const binary = new WebAssembly.Module(readFileSync(join(process.cwd(), "public", "audio", "gtcrn.wasm")));

/** Uniform noise from a fixed seed (mulberry32), so every run hears the same room. */
function noise(seconds: number, rms: number, seed = 7): Float32Array {
  let state = seed >>> 0;
  const out = new Float32Array(seconds * RATE);
  const scale = rms * Math.sqrt(3) * 2;
  for (let i = 0; i < out.length; i += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4_294_967_296 - 0.5) * scale;
  }
  return out;
}

function rmsDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (samples[i] as number) ** 2;
  return 10 * Math.log10(sum / (to - from));
}

function run(denoiser: GtcrnDenoiser, input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let at = 0; at + QUANTUM <= input.length; at += QUANTUM) {
    denoiser.run(input.subarray(at, at + QUANTUM), output.subarray(at, at + QUANTUM));
  }
  return output;
}

/**
 * Stands in for the binary where a test needs to see exactly what the wrapper
 * hands it: a memory and an allocator, and a frame function that records its
 * input and gives it back unchanged.
 */
function stub(frames: Float32Array[]): GtcrnExports {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let next = 16;
  return {
    memory,
    malloc: (size) => {
      const at = next;
      next += size;
      return at;
    },
    free: () => {},
    gtcrn_create: () => 1,
    gtcrn_destroy: () => {},
    gtcrn_process_48k: (_state, input, output) => {
      const frame = new Float32Array(memory.buffer, input, FRAME).slice();
      frames.push(frame);
      new Float32Array(memory.buffer, output, FRAME).set(frame);
    },
  };
}

describe("GtcrnDenoiser framing", () => {
  it("hands the module whole frames and gives the samples back BUFFERING late", () => {
    const frames: Float32Array[] = [];
    const input = noise(1, 0.1);
    const output = run(new GtcrnDenoiser(stub(frames)), input);

    expect(frames).toHaveLength(Math.floor(input.length / FRAME));
    expect(frames[3]?.[5]).toBe(input[3 * FRAME + 5]);
    // An identity module has no delay of its own, so what is left is the framing's.
    expect(output.subarray(0, BUFFERING).every((sample) => sample === 0)).toBe(true);
    for (let i = 0; i < input.length - BUFFERING - FRAME; i += 1) {
      expect(output[i + BUFFERING]).toBe(input[i]);
    }
  });
});

describe("GtcrnDenoiser on gtcrn.wasm", () => {
  it("turns steady noise down by tens of dB once it has settled", () => {
    // Two seconds of noise at -30 dBFS.
    const input = noise(2, 0.0316);
    const output = run(new GtcrnDenoiser(instantiateGtcrn(binary)), input);
    const settled = [1 * RATE, 2 * RATE] as const;
    expect(rmsDb(output, ...settled) - rmsDb(input, ...settled)).toBeLessThan(-20);
  });

  it("gives a destroyed state's memory back", () => {
    const gtcrn = instantiateGtcrn(binary);
    const frame = new Float32Array(QUANTUM);
    const cycle = () => {
      const denoiser = new GtcrnDenoiser(gtcrn);
      denoiser.run(frame, frame);
      return denoiser;
    };
    cycle().destroy();
    const settled = gtcrn.memory.buffer.byteLength;

    for (let i = 0; i < 200; i += 1) cycle().destroy();
    expect(gtcrn.memory.buffer.byteLength).toBe(settled);

    // The same states kept alive need room the memory did not have, so the
    // check above would have seen a state that was not freed.
    const alive = Array.from({ length: 40 }, cycle);
    expect(gtcrn.memory.buffer.byteLength).toBeGreaterThan(settled);
    // The first of them was made before the memory grew, and still works.
    const output = new Float32Array(QUANTUM);
    (alive[0] as GtcrnDenoiser).run(noise(1, 0.01).subarray(0, QUANTUM), output);
    expect(output.every(Number.isFinite)).toBe(true);
    for (const denoiser of alive) denoiser.destroy();
  });

  it("stays finite on samples far past full scale", () => {
    const input = noise(1, 0.5);
    for (let i = 0; i < input.length; i += 7) input[i] = (i % 2 === 0 ? 1 : -1) * 8;
    const output = run(new GtcrnDenoiser(instantiateGtcrn(binary)), input);
    expect(output.every(Number.isFinite)).toBe(true);
  });

  it("refuses to run once destroyed", () => {
    const denoiser = new GtcrnDenoiser(instantiateGtcrn(binary));
    denoiser.destroy();
    denoiser.destroy();
    expect(() => denoiser.run(new Float32Array(QUANTUM), new Float32Array(QUANTUM))).toThrow();
  });
});
