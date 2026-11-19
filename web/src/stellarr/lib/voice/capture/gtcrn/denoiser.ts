/**
 * GTCRN, driven through the exports of gtcrn.wasm, which
 * artifacts/recipes/gtcrn/ builds from the model's source. The worklet's
 * processor (`processor.ts`) is a thin shell around this, and the tests drive
 * the real binary through it in Node.
 *
 * The binary imports nothing and needs no generated JavaScript: it is
 * instantiated with an empty import object, and everything below is a plain
 * call into its exports.
 *
 * The module takes frames of 768 samples (16 ms at 48 kHz) as floats in
 * [-1, 1], resamples them 3:1 inside, runs the network at 16 kHz and gives
 * 768 samples back. The render thread hands over 128 at a time, so six
 * quanta make a frame: they are gathered in the module's memory, the frame is
 * cleaned in the quantum that completes it, and what comes out is handed to
 * the next six. See `BUFFERING` and `LATENCY`.
 */

/** What gtcrn.wasm exports: its memory, an allocator and the three calls of the worklet. */
export interface GtcrnExports {
  readonly memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  /** A state for one voice; 0 when out of memory. */
  gtcrn_create(): number;
  gtcrn_destroy(state: number): void;
  /** Cleans one frame of `FRAME` samples at `input` into `output`; the two must not overlap. */
  gtcrn_process_48k(state: number, input: number, output: number): void;
}

/** One instance of the binary. Each holds its own memory, the network's weights among it, and any number of states. */
export function instantiateGtcrn(module: WebAssembly.Module): GtcrnExports {
  return new WebAssembly.Instance(module, {}).exports as unknown as GtcrnExports;
}

/** The module's frame: 16 ms at 48 kHz, the only rate it is built for. */
export const FRAME = 768;

/** One render quantum, what the processor is given each time. */
export const QUANTUM = 128;

/** Quanta to a frame. */
const QUANTA_PER_FRAME = FRAME / QUANTUM;

/**
 * Samples of delay the framing adds: a frame is cleaned in the quantum that
 * completes it and its first quantum is handed out right then, so the sample
 * at position `p` of the input comes out at `p + BUFFERING` at the earliest,
 * five quanta late. The model and the resampler add their own on top, which
 * the suppressor record holds.
 */
export const BUFFERING = FRAME - QUANTUM;

const FLOAT_BYTES = 4;

export class GtcrnDenoiser {
  private state: number;
  /** Where the frame being gathered lives in the module's memory, as floats, and where the cleaned one is put. */
  private input: number;
  private output: number;
  /** Views of the two; made again when the memory grows, which detaches the old ones. */
  private inputView: Float32Array;
  private outputView: Float32Array;
  /** Which quantum of the frame comes next, 0 to `QUANTA_PER_FRAME` - 1. */
  private quantum = 0;

  constructor(private readonly gtcrn: GtcrnExports) {
    this.state = gtcrn.gtcrn_create();
    this.input = gtcrn.malloc(FRAME * FLOAT_BYTES);
    this.output = gtcrn.malloc(FRAME * FLOAT_BYTES);
    if (this.state === 0 || this.input === 0 || this.output === 0) {
      this.destroy();
      throw new Error("gtcrn.wasm is out of memory");
    }
    this.inputView = new Float32Array(gtcrn.memory.buffer, this.input, FRAME);
    this.outputView = new Float32Array(gtcrn.memory.buffer, this.output, FRAME);
    // Nothing is cleaned yet, and the first quanta hand out what is here.
    this.outputView.fill(0);
  }

  /**
   * Cleans one render quantum, `QUANTUM` samples of `input`, into `output`.
   * The first `BUFFERING` samples out and whatever the model's own delay adds
   * are silence. Nothing is allocated unless the module's memory has grown
   * since the last call, which a running state never makes it do.
   *
   * Samples go in as they are, past full scale too: everything here is
   * float, so nothing can wrap, and the published worklet did the same.
   */
  run(input: Float32Array, output: Float32Array): void {
    if (this.state === 0) throw new Error("the GTCRN state was destroyed");
    let inputView = this.inputView;
    let outputView = this.outputView;
    if (inputView.buffer !== this.gtcrn.memory.buffer) {
      inputView = new Float32Array(this.gtcrn.memory.buffer, this.input, FRAME);
      outputView = new Float32Array(this.gtcrn.memory.buffer, this.output, FRAME);
      this.inputView = inputView;
      this.outputView = outputView;
    }
    const at = this.quantum * QUANTUM;
    inputView.set(input.subarray(0, QUANTUM), at);
    if (this.quantum === QUANTA_PER_FRAME - 1) {
      this.gtcrn.gtcrn_process_48k(this.state, this.input, this.output);
      // The cleaned frame is handed out from its start, in the quantum that
      // completed it.
      output.set(outputView.subarray(0, QUANTUM));
      this.quantum = 0;
    } else {
      const from = (this.quantum + 1) * QUANTUM;
      output.set(outputView.subarray(from, from + QUANTUM));
      this.quantum += 1;
    }
  }

  /** Frees the state and the two frames. Idempotent; `run` refuses afterwards. */
  destroy(): void {
    if (this.state !== 0) this.gtcrn.gtcrn_destroy(this.state);
    if (this.input !== 0) this.gtcrn.free(this.input);
    if (this.output !== 0) this.gtcrn.free(this.output);
    this.state = 0;
    this.input = 0;
    this.output = 0;
  }
}
