import {
  GATE_DEFAULTS,
  VAD_PROCESSOR_NAME,
  sensitivityToThresholds,
} from "../../../public/audio/vad-processor.js";
import type { DetectorStages } from "./micCapture";
import { VAD_WORKLET_URL } from "./vad";

const registered = new WeakSet<AudioContext>();

/**
 * The input gate and the leveller are the speech detector itself, in audible
 * mode.
 *
 * The same `AdaptiveVad` that draws the ring around your avatar decides when
 * the others hear you and which frames the leveller may learn from; see
 * `vad-processor.js` for the lookahead that stops the gate clipping the first
 * syllable. Resolves to null when AudioWorklet is missing or the module will not
 * load, so the capture proceeds without these stages rather than not at all.
 */
export async function buildGateNode(
  context: AudioContext,
  sensitivity: number,
  stages: DetectorStages,
): Promise<AudioWorkletNode | null> {
  if (typeof AudioWorkletNode === "undefined" || !context.audioWorklet) return null;
  try {
    if (!registered.has(context)) {
      await context.audioWorklet.addModule(VAD_WORKLET_URL);
      registered.add(context);
    }
    return new AudioWorkletNode(context, VAD_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        sampleRate: context.sampleRate,
        gate: stages.gate,
        gateEnabled: true,
        leveller: stages.leveller,
        levellerEnabled: true,
        lookaheadMs: GATE_DEFAULTS.lookaheadMs,
        attackMs: GATE_DEFAULTS.attackMs,
        releaseMs: GATE_DEFAULTS.releaseMs,
        // The node never talks to the main thread; the monitor stream's own
        // detector does that, on identical audio with identical thresholds.
        publishSilentLevels: false,
        ...sensitivityToThresholds(sensitivity),
      },
    });
  } catch {
    return null;
  }
}
