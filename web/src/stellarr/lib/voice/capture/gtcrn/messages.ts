/**
 * What crosses between the GTCRN worklet and the main thread: the name it
 * registers under, the options it is built with, and the one message it
 * sends, once its constructor has made the denoiser. The one message it takes
 * is the "destroy" that noiseSuppression.ts sends every engine.
 */

/** The name the worklet registers its processor under. */
export const GTCRN_PROCESSOR_NAME = "stellarr-gtcrn";

/**
 * `processorOptions` of the GTCRN node: gtcrn.wasm, already compiled. The
 * binary holds the network's weights as code and data and compiling it
 * would hold up every node of the context on the render thread while it ran;
 * the main thread compiles it off any thread that renders, and the
 * processor only instantiates it.
 */
export interface GtcrnOptions {
  module: WebAssembly.Module;
}

/**
 * Posted by the processor when its denoiser exists. A constructor that throws
 * posts nothing, and the node fires "processorerror" instead.
 */
export const GTCRN_READY = "ready";
