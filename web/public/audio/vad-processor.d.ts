/**
 * Types for the AudioWorklet module in `vad-processor.js`.
 *
 * The implementation is plain JavaScript because `AudioWorklet.addModule` loads
 * it directly from `/audio/…` and it must not go through the bundler. This
 * declaration lets `vad.ts` and the tests import the same file under strict
 * TypeScript.
 */

export interface VadConfig {
  frameMs: number;
  sampleRate: number;
  snrOnDb: number;
  snrOffDb: number;
  absoluteFloorDb: number;
  attackFrames: number;
  transientRiseDb: number;
  transientCrestDb: number;
  transientBlockFrames: number;
  transientReleaseQuietFrames: number;
  hangoverFrames: number;
  /** Periodicity (0..1) a frame needs to open the detector; 0 disables the check. */
  voicingOn: number;
  voicedHoldFrames: number;
  maxUnvoicedFrames: number;
  noiseDownAlpha: number;
  noiseUpAlpha: number;
  noiseUpAlphaActive: number;
  noiseUpAlphaStationary: number;
  stationaryAfterFrames: number;
  stationaryDeltaDb: number;
  trackingFloorDb: number;
  warmupFrames: number;
  noiseWarmupAlpha: number;
  noiseFloorInitDb: number;
  noiseFloorMinDb: number;
  noiseFloorMaxDb: number;
  levelMinDb: number;
  levelMaxDb: number;
  levelAttack: number;
  levelRelease: number;
}

export interface VadFrameResult {
  speaking: boolean;
  /** Smoothed 0..1 level for the meter. */
  level: number;
  dbfs: number;
  /** Largest absolute sample in the frame, 0..1. */
  peak: number;
  noiseFloorDb: number;
  snrDb: number;
  /** True for a short high-crest impact rejected as mechanical noise. */
  transient: boolean;
  /** Peak normalised autocorrelation over the pitch range, 0..1; 0 when not measured. */
  voicing: number;
  /** True when the frame cleared the energy test *and* had a pitch. */
  voiced: boolean;
}

export declare const VAD_DEFAULTS: Readonly<VadConfig>;

export interface VoicingConfig {
  sampleRate: number;
  analysisRate: number;
  windowMs: number;
  minPitchHz: number;
  maxPitchHz: number;
  lowpassHz: number;
}

export declare const VOICING_DEFAULTS: Readonly<Omit<VoicingConfig, "sampleRate">>;

export declare class VoicingDetector {
  constructor(options?: Partial<VoicingConfig>);
  readonly decimation: number;
  readonly window: number;
  readonly lagMin: number;
  readonly lagMax: number;
  reset(): void;
  push(frame: Float32Array | number[], length?: number): void;
  peak(): number;
}

export interface LevellerConfig {
  sampleRate: number;
  targetDb: number;
  maxBoostDb: number;
  maxCutDb: number;
  levelAlpha: number;
  riseDbPerSecond: number;
  fallDbPerSecond: number;
  peakCeiling: number;
  minVoicedFrames: number;
}

export declare const LEVELLER_DEFAULTS: Readonly<Omit<LevellerConfig, "sampleRate">>;

export declare class Leveller {
  constructor(options: Partial<LevellerConfig> & { sampleRate: number });
  gain: number;
  targetGain: number;
  speechDb: number | null;
  enabled: boolean;
  readonly target: number;
  reset(): void;
  setEnabled(enabled: boolean): void;
  observe(result: { dbfs: number; voiced: boolean; peak?: number }): void;
  process(input: Float32Array, output: Float32Array, length?: number): void;
}
export declare const LEVEL_STEPS: number;
export declare const VAD_PROCESSOR_NAME: string;

export declare function frameMeanSquare(
  frame: Float32Array | number[],
  length?: number,
): number;

export declare function framePeakAbs(
  frame: Float32Array | number[],
  length?: number,
): number;

export declare function meanSquareToDbfs(meanSquare: number): number;

export interface VadThresholds {
  snrOnDb: number;
  snrOffDb: number;
  hangoverFrames: number;
  absoluteFloorDb: number;
  voicingOn: number;
}

export interface GateConfig {
  sampleRate: number;
  lookaheadMs: number;
  attackMs: number;
  releaseMs: number;
  closedGain: number;
}

export declare const GATE_DEFAULTS: Readonly<Omit<GateConfig, "sampleRate">>;

export declare class GateSmoother {
  constructor(options: Partial<GateConfig> & { sampleRate: number });
  readonly delaySamples: number;
  readonly target: number;
  gain: number;
  enabled: boolean;
  open: boolean;
  setOpen(open: boolean): void;
  setEnabled(enabled: boolean): void;
  reset(): void;
  process(input: Float32Array, output: Float32Array, length?: number): void;
}

export declare function sensitivityToThresholds(sensitivity: number): VadThresholds;

export declare class AdaptiveVad {
  constructor(options?: Partial<VadConfig>);
  readonly config: VadConfig;
  readonly frameSize: number;
  speaking: boolean;
  level: number;
  noiseFloorDb: number;
  readonly warmingUp: boolean;
  reset(): void;
  configure(patch: Partial<VadConfig>): void;
  push(chunk: Float32Array, out?: VadFrameResult[]): VadFrameResult[];
  processFrame(frame: Float32Array): VadFrameResult;
}

export declare class VadPublisher {
  constructor(options?: {
    minFramesBetweenLevelPosts?: number;
    publishSilentLevels?: boolean;
  });
  consider(result: {
    speaking: boolean;
    level: number;
  }): { speaking: boolean; level: number } | null;
  reset(): void;
}
