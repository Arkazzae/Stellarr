import type { WorkletSuppressor } from "./audioProfiles";
import { buildGateNode } from "./gateNode";
import { attachSuppressor, type NoiseSuppressorHandle } from "./noiseSuppression";
import { resolvePlaybackProfile } from "./playbackProfile";
import { RemoteStrip } from "./remoteStrip";
import {
  PLAYBACK_TUNING_PRESETS,
  type PlaybackProfileId,
  type PlaybackTuning,
} from "./settings";

export {
  PLAYBACK_PROFILES,
  resolvePlaybackProfile,
  type PlaybackProfile,
} from "./playbackProfile";
export { clampParticipantVolume } from "./remoteStrip";

/**
 * How eagerly a receiver-side gate opens for someone else's microphone.
 *
 * Deliberately stricter than the default local dial (60): the person you
 * gate is, by definition, the one whose between-word noise you want gone, and
 * their speech arrives already levelled by their own AGC, so a higher bar
 * costs no real words.
 */
export const REMOTE_GATE_SENSITIVITY = 40;

/**
 * The engine used when a listener cleans someone else's strip locally.
 *
 * GTCRN rather than RNNoise: the strip is being cleaned precisely because
 * what arrives is not steady hiss but chewing, a keyboard, a room — the
 * non-stationary noise the newer network was trained on. It costs more CPU,
 * and it costs it for one strip, chosen on purpose.
 */
export const REMOTE_SUPPRESSOR: WorkletSuppressor = "gtcrn";

/**
 * Unity from a browser microphone is commonly quieter than ordinary web media,
 * so the default 100% sits a little above it.
 *
 * Deliberately modest. At 1.6 this lift, stacked on up to 6 dB of compressor
 * makeup, held the limiter down the whole time a call was running: every voice
 * arrived pinned to the ceiling, which is why nobody could make anyone quieter
 * and everyone was loud. The limiter is meant to catch peaks, not to be the
 * operating level.
 */
export const VOICE_PLAYBACK_GAIN = 1.25;

/** The suppressor consumes fixed 10 ms frames, which only fit 48 kHz. */
const RECEIVER_SAMPLE_RATE = 48_000;

/** Local processing a listener can put on one strip. */
export interface StripProcessing {
  gated?: boolean;
  suppressed?: boolean;
}

export interface RemoteVoiceMixerDeps {
  /** Inserts a suppressor worklet; injectable so tests need no WASM. */
  attach?: typeof attachSuppressor;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** A context the browser refused to open at 48 kHz cannot host a suppressor. */
function runsAtSuppressorRate(context: AudioContext): boolean {
  const rate = context.sampleRate;
  return !Number.isFinite(rate) || rate <= 0 || rate === RECEIVER_SAMPLE_RATE;
}

/**
 * A receiver-side voice mixer built on Web Audio.
 *
 * Every participant gets a separate strip and a separate MediaStream output.
 * That last detail preserves the existing hidden `<audio>` element, including
 * `setSinkId`, autoplay recovery and deafen behaviour. If Web Audio is absent
 * or refuses a stream, `attach` returns false and the caller plays it raw.
 */
export class RemoteVoiceMixer {
  private context: AudioContext | null = null;
  private readonly strips = new Map<string, RemoteStrip>();
  private profile: PlaybackProfileId;
  private tuning: PlaybackTuning;
  private readonly attachSuppressorNode: typeof attachSuppressor;

  constructor(
    profile: PlaybackProfileId,
    tuning?: PlaybackTuning,
    private readonly playbackGain = VOICE_PLAYBACK_GAIN,
    deps: RemoteVoiceMixerDeps = {},
  ) {
    this.profile = profile;
    this.tuning = {
      ...(tuning ??
        PLAYBACK_TUNING_PRESETS[profile === "custom" ? "studio" : profile]),
    };
    this.attachSuppressorNode = deps.attach ?? attachSuppressor;
  }

  /**
   * Create and resume the receiver graph while a user gesture is still active.
   *
   * Remote tracks arrive well after the click that joined a call. Chromium and
   * Brave are allowed to create an AudioContext then but may leave it suspended,
   * which produces a perfectly healthy RTP connection with silent playback.
   */
  prepare(): void {
    const context = this.ensureContext();
    if (context?.state === "suspended") void context.resume().catch(() => undefined);
  }

  /**
   * Plays `stream` through a new strip for `participantId`, replacing any
   * earlier one. The processing a listener already chose for this person is
   * applied in the background once the strip exists.
   */
  attach(
    participantId: string,
    stream: MediaStream,
    element: HTMLAudioElement,
    volume: number,
    processing: StripProcessing = {},
  ): boolean {
    const attached = this.mount(participantId, element, volume, (context) =>
      context.createMediaStreamSource(stream),
    );
    if (!attached) return false;
    if (processing.suppressed) void this.setSuppressor(participantId, true);
    if (processing.gated) void this.setGate(participantId, true);
    return true;
  }

  /** Routes a local recording through the exact same receiver-side strip. */
  attachElement(
    participantId: string,
    sourceElement: HTMLMediaElement,
    outputElement: HTMLAudioElement,
    volume: number,
  ): boolean {
    return this.mount(participantId, outputElement, volume, (context) =>
      context.createMediaElementSource(sourceElement),
    );
  }

  setProfile(profile: PlaybackProfileId, tuning: PlaybackTuning): void {
    this.profile = profile;
    this.tuning = { ...tuning };
    const parameters = resolvePlaybackProfile(profile, tuning);
    for (const strip of this.strips.values()) strip.applyProfile(parameters, false);
  }

  setVolume(participantId: string, volume: number): void {
    this.strips.get(participantId)?.setVolume(volume, false);
  }

  /**
   * Insert or remove the gate on one strip.
   *
   * The worklet module loads asynchronously the first time. The gate sits
   * before the EQ and compressor so the makeup gain never lifts what it shut.
   * Resolves to whether the strip is gated afterwards.
   */
  setGate(participantId: string, gated: boolean): Promise<boolean> {
    const strip = this.strips.get(participantId);
    const context = this.context;
    if (!strip || !context) return Promise.resolve(false);
    return strip.run(async () => {
      if (strip.released) return false;
      if (gated === strip.gated) return true;
      if (!gated) {
        await strip.removeGate();
        return true;
      }
      const gate = await buildGateNode(context, REMOTE_GATE_SENSITIVITY, {
        gate: true,
        leveller: false,
      });
      if (!gate) return false;
      await strip.addGate(gate);
      return strip.gated;
    });
  }

  /**
   * Insert or remove a local suppressor on one strip.
   *
   * It goes in front of everything, so the gate behind it sees cleaned audio,
   * the same order as the sender's own pipeline. Resolves to whether the strip
   * is suppressed afterwards; false when the engine or the context cannot host it.
   */
  setSuppressor(participantId: string, suppressed: boolean): Promise<boolean> {
    const strip = this.strips.get(participantId);
    const context = this.context;
    if (!strip || !context) return Promise.resolve(false);
    return strip.run(async () => {
      if (strip.released) return false;
      if (suppressed === strip.suppressed) return true;
      if (!suppressed) {
        await strip.removeSuppressor();
        return true;
      }
      if (!runsAtSuppressorRate(context)) return false;

      let handle: NoiseSuppressorHandle | null;
      try {
        handle = await this.attachSuppressorNode(REMOTE_SUPPRESSOR, context, strip.source);
      } catch {
        handle = null;
      }
      if (!handle) return false;
      await strip.addSuppressor(handle);
      return strip.suppressed;
    });
  }

  /** True while this participant's strip carries a gate. */
  isGated(participantId: string): boolean {
    return this.strips.get(participantId)?.gated ?? false;
  }

  /** True while this participant's strip carries a local suppressor. */
  isSuppressed(participantId: string): boolean {
    return this.strips.get(participantId)?.suppressed ?? false;
  }

  async resume(): Promise<boolean> {
    const context = this.context;
    if (!context) return false;
    if (context.state === "running") return true;
    if (context.state === "closed") return false;
    try {
      await context.resume();
    } catch {
      // The audio elements still retain their processed streams; the next user
      // gesture or lifecycle pass can resume the context again.
    }
    return (context.state as AudioContextState) === "running";
  }

  remove(participantId: string): void {
    const strip = this.strips.get(participantId);
    if (!strip) return;
    this.strips.delete(participantId);
    strip.release();
  }

  dispose(): void {
    for (const strip of this.strips.values()) strip.release();
    this.strips.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  private mount(
    participantId: string,
    element: HTMLAudioElement,
    volume: number,
    createSource: (context: AudioContext) => AudioNode,
  ): boolean {
    const context = this.ensureContext();
    if (!context) return false;

    this.remove(participantId);
    let strip: RemoteStrip | null = null;
    try {
      strip = new RemoteStrip(context, createSource(context), this.playbackGain);
      strip.applyProfile(resolvePlaybackProfile(this.profile, this.tuning), true);
      strip.setVolume(volume, true);
      element.srcObject = strip.output;
    } catch {
      strip?.release();
      return false;
    }

    this.strips.set(participantId, strip);
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return true;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      this.context = new Ctor({
        sampleRate: RECEIVER_SAMPLE_RATE,
        latencyHint: "interactive",
      });
    } catch {
      try {
        this.context = new Ctor();
      } catch {
        return null;
      }
    }
    return this.context;
  }
}
