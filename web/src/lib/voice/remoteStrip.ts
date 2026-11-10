import type { NoiseSuppressorHandle } from "./noiseSuppression";
import type { PlaybackProfile } from "./playbackProfile";

/**
 * How long a strip is muted for while its graph is rewired.
 *
 * Long enough to span a render quantum at any sample rate the browser will
 * give us, short enough that nobody hears a word go missing.
 */
const REWIRE_FADE_MS = 18;

/** Time constant of a live parameter change, so a slider drag does not zipper. */
const PARAM_SMOOTHING_SECONDS = 0.025;

export function clampParticipantVolume(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(0, Math.round(value)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function disconnectQuietly(node: AudioNode, target?: AudioNode): void {
  try {
    if (target) node.disconnect(target);
    else node.disconnect();
  } catch {
    // Already detached, or never wired: the browser throws for both.
  }
}

function stopGate(gate: AudioWorkletNode): void {
  try {
    gate.port.postMessage({ type: "stop" });
  } catch {
    // The port may already be closed.
  }
  disconnectQuietly(gate);
}

type Chain = {
  highpass: BiquadFilterNode;
  warmth: BiquadFilterNode;
  mud: BiquadFilterNode;
  presence: BiquadFilterNode;
  air: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  makeup: GainNode;
  /**
   * Everything above unity the listener asked for, plus the fixed headroom
   * lift. It sits in front of the limiter, which is what keeps a boost from
   * clipping.
   */
  boost: GainNode;
  limiter: DynamicsCompressorNode;
  /**
   * Everything below unity, behind the limiter.
   *
   * With the whole fader in front of a -1 dBFS limiter, turning someone down
   * mostly took away the limiter's work instead of their volume: the output
   * stayed pinned near the ceiling and the slider read as broken. Attenuation
   * has to be the last thing in the chain.
   */
  trim: GainNode;
  destination: MediaStreamAudioDestinationNode;
};

/**
 * Creates and wires the fixed part of a strip:
 * source > highpass > EQ > compressor > makeup > boost > limiter > trim > output.
 *
 * On failure everything built so far, `source` included, is released.
 */
function buildChain(context: AudioContext, source: AudioNode): Chain {
  const destination = context.createMediaStreamDestination();
  const created: AudioNode[] = [source, destination];
  const make = <T extends AudioNode>(node: T): T => {
    created.push(node);
    return node;
  };

  try {
    const chain: Chain = {
      highpass: make(context.createBiquadFilter()),
      warmth: make(context.createBiquadFilter()),
      mud: make(context.createBiquadFilter()),
      presence: make(context.createBiquadFilter()),
      air: make(context.createBiquadFilter()),
      compressor: make(context.createDynamicsCompressor()),
      makeup: make(context.createGain()),
      boost: make(context.createGain()),
      limiter: make(context.createDynamicsCompressor()),
      trim: make(context.createGain()),
      destination,
    };

    chain.highpass.type = "highpass";
    chain.warmth.type = "lowshelf";
    chain.warmth.frequency.value = 160;
    chain.mud.type = "peaking";
    chain.mud.frequency.value = 360;
    chain.mud.Q.value = 1;
    chain.presence.type = "peaking";
    chain.presence.frequency.value = 3_100;
    chain.presence.Q.value = 0.9;
    chain.air.type = "highshelf";
    chain.air.frequency.value = 8_000;

    // EQ, compressor makeup and the upper half of the participant slider can
    // all add energy. A fast brick-wall limiter keeps that useful range from
    // becoming hard clipping.
    chain.limiter.threshold.value = -1;
    chain.limiter.knee.value = 0;
    chain.limiter.ratio.value = 20;
    chain.limiter.attack.value = 0.002;
    chain.limiter.release.value = 0.08;

    const path: AudioNode[] = [
      source,
      chain.highpass,
      chain.warmth,
      chain.mud,
      chain.presence,
      chain.air,
      chain.compressor,
      chain.makeup,
      chain.boost,
      chain.limiter,
      chain.trim,
      destination,
    ];
    path.forEach((node, index) => {
      const next = path[index + 1];
      if (next) node.connect(next);
    });
    return chain;
  } catch (error) {
    for (const node of created) disconnectQuietly(node);
    for (const track of destination.stream.getTracks()) track.stop();
    throw error;
  }
}

/**
 * One participant's signal path inside the receiver mixer.
 *
 * The fixed chain (EQ, compressor, limiter, fader) is built once. A gate and a
 * suppressor can be added in front of it and removed again; each such change
 * runs inside a short fade so it cannot click, and changes to one strip are
 * serialised with `run` so two of them never fade over each other.
 */
export class RemoteStrip {
  /** The processed audio, for the hidden `<audio>` element to play. */
  readonly output: MediaStream;
  private readonly chain: Chain;
  private suppressor: NoiseSuppressorHandle | null = null;
  private gate: AudioWorkletNode | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  /** What `trim` returns to after a rewiring fade has muted it. */
  private trimTarget = 1;
  /** True while a fade owns the trim; see `rewire`. */
  private fading = false;
  private closed = false;

  /** Takes ownership of `source`: it is disconnected if the chain cannot be built. */
  constructor(
    private readonly context: AudioContext,
    readonly source: AudioNode,
    private readonly playbackGain: number,
  ) {
    this.chain = buildChain(context, source);
    this.output = this.chain.destination.stream;
  }

  get gated(): boolean {
    return this.gate !== null;
  }

  get suppressed(): boolean {
    return this.suppressor !== null;
  }

  get released(): boolean {
    return this.closed;
  }

  /** Queues a change to this strip behind the ones already running. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  applyProfile(profile: PlaybackProfile, immediate: boolean): void {
    const { highpass, warmth, mud, presence, air, compressor, makeup } = this.chain;
    const targets: Array<[AudioParam, number]> = [
      [highpass.frequency, profile.highpassHz],
      [warmth.gain, profile.warmthDb],
      [mud.gain, profile.mudDb],
      [presence.gain, profile.presenceDb],
      [air.gain, profile.airDb],
      [compressor.threshold, profile.compressorThresholdDb],
      [compressor.knee, profile.compressorKneeDb],
      [compressor.ratio, profile.compressorRatio],
      [compressor.attack, profile.compressorAttack],
      [compressor.release, profile.compressorRelease],
      [makeup.gain, profile.compressorMakeupGain],
    ];
    for (const [param, value] of targets) this.setParam(param, value, immediate);
  }

  /**
   * The listener's dial, split across the limiter.
   *
   * Above 100% the extra gain goes in front of it, where it is caught; at and
   * below 100% the fader is behind it, where 50% is genuinely 6 dB quieter.
   * The fixed headroom lift travels with the boost for the same reason.
   */
  setVolume(volume: number, immediate: boolean): void {
    const scale = clampParticipantVolume(volume) / 100;
    this.setParam(this.chain.boost.gain, this.playbackGain * Math.max(1, scale), immediate);
    this.trimTarget = Math.min(1, scale);
    // A fade owns the trim while it is running; writing the new level under it
    // would undo the mute and put the click back. The fade restores it.
    if (!this.fading) this.setParam(this.chain.trim.gain, this.trimTarget, immediate);
  }

  /**
   * Puts `gate` between the strip's front and its EQ. Takes ownership of the
   * node: if the strip is released first, the gate is stopped.
   */
  async addGate(gate: AudioWorkletNode): Promise<void> {
    const done = await this.rewire(() => {
      const front = this.front();
      disconnectQuietly(front, this.chain.highpass);
      front.connect(gate);
      gate.connect(this.chain.highpass);
      this.gate = gate;
    });
    if (!done) stopGate(gate);
  }

  async removeGate(): Promise<void> {
    await this.rewire(() => {
      const gate = this.gate;
      if (!gate) return;
      this.gate = null;
      const front = this.front();
      disconnectQuietly(front, gate);
      stopGate(gate);
      front.connect(this.chain.highpass);
    });
  }

  /**
   * Puts a suppressor in front of everything, so the gate behind it judges
   * cleaned audio. Takes ownership of the handle: if the strip is released
   * first, it is disposed.
   */
  async addSuppressor(handle: NoiseSuppressorHandle): Promise<void> {
    const done = await this.rewire(() => {
      const next = this.afterFront();
      disconnectQuietly(this.source, next);
      handle.output.connect(next);
      this.suppressor = handle;
    });
    if (!done) handle.dispose();
  }

  async removeSuppressor(): Promise<void> {
    await this.rewire(() => {
      const handle = this.suppressor;
      if (!handle) return;
      this.suppressor = null;
      disconnectQuietly(handle.output);
      // Releases the worklet and its WASM heap, and the source > suppressor edge.
      handle.dispose();
      this.source.connect(this.afterFront());
    });
  }

  /** Ends the output track and detaches every node. Idempotent. */
  release(): void {
    if (this.closed) return;
    this.closed = true;
    const { gate, suppressor } = this;
    this.gate = null;
    this.suppressor = null;

    if (gate) stopGate(gate);
    try {
      suppressor?.dispose();
    } catch {
      // Already released.
    }
    // A MediaStreamAudioDestinationNode owns a real MediaStreamTrack. Merely
    // disconnecting the graph does not end that track in Chromium, so every
    // output-device change would otherwise leak another live audio source.
    for (const track of this.output.getTracks()) track.stop();
    for (const node of [this.source, ...Object.values(this.chain)]) {
      disconnectQuietly(node);
    }
  }

  /** The node that feeds the gate (or, without one, the EQ). */
  private front(): AudioNode {
    return this.suppressor ? this.suppressor.output : this.source;
  }

  /** What the front node feeds: the gate while there is one, else the EQ. */
  private afterFront(): AudioNode {
    return this.gate ?? this.chain.highpass;
  }

  /**
   * Rewires the strip without a click.
   *
   * Inserting or removing a worklet reconnects the graph between two render
   * quanta, and the waveform either side of that seam has no reason to line
   * up: the discontinuity is heard as a tick, and the level a suppressor
   * settles at differs from the raw signal, so the switch also jumps. Muting
   * the strip for the length of the change and ramping back turns both into a
   * short dip, which is what switching something on is allowed to sound like.
   *
   * Resolves to false, without calling `change`, when the strip was released
   * before the change could run.
   */
  private async rewire(change: () => void): Promise<boolean> {
    if (this.closed) return false;
    this.fading = true;
    this.rampTrim(0);
    try {
      await sleep(REWIRE_FADE_MS);
      if (this.closed) return false;
      change();
      return true;
    } finally {
      this.fading = false;
      if (!this.closed) this.rampTrim(this.trimTarget);
    }
  }

  private rampTrim(value: number): void {
    const param = this.chain.trim.gain;
    const now = this.context.currentTime;
    if (typeof param.linearRampToValueAtTime !== "function") {
      param.value = value;
      return;
    }
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + REWIRE_FADE_MS / 1000);
    } catch {
      param.value = value;
    }
  }

  private setParam(param: AudioParam, value: number, immediate: boolean): void {
    if (immediate || typeof param.setTargetAtTime !== "function") {
      param.value = value;
      return;
    }
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, PARAM_SMOOTHING_SECONDS);
  }
}
