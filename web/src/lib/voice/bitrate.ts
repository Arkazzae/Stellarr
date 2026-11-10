/**
 * Adaptive bitrate ceiling.
 *
 * This is deliberately not congestion control. The browser's own bandwidth
 * estimator owns the send rate and reacts in milliseconds; competing with it
 * would make things worse. What this moves is the ceiling the encoder may aim
 * for, on the timescale of seconds, from the loss and RTT the browser already
 * measures. On a link quietly dropping 10% of packets, a lower ceiling with FEC
 * sounds far better than a high one.
 *
 * Three rules keep it from oscillating:
 * - readings are smoothed, so one bad sample moves nothing;
 * - dropping needs few consecutive confirmations, recovering needs many;
 * - a new target is applied only when it differs materially from the current.
 */

export type NetworkQuality = "unknown" | "good" | "fair" | "poor";

export interface NetworkSample {
  /** 0..1 */
  lossFraction: number;
  rttMs: number;
}

export interface BitrateDecision {
  bitrate: number;
  quality: NetworkQuality;
  /** True only when the ceiling actually moved. */
  changed: boolean;
}

export interface AdaptiveBitrateOptions {
  /** The profile's ceiling. The controller never exceeds it. */
  ceiling: number;
  /** The profile's floor. The controller never goes below it. */
  floor: number;
  /** Weight of each new sample in the smoothed value. */
  smoothing?: number;
  /** Consecutive worse-tier samples before the ceiling drops. */
  downgradeAfter?: number;
  /** Consecutive better-tier samples before the ceiling rises. */
  upgradeAfter?: number;
  /** Relative change needed before a new target is applied. */
  minRelativeChange?: number;
}

/** Fraction of the profile ceiling allowed at each quality tier. */
const TIER_FACTOR: Record<NetworkQuality, number> = {
  unknown: 1,
  good: 1,
  fair: 0.7,
  poor: 0.45,
};

/** Higher is worse; a link not yet measured counts as better than any reading. */
const SEVERITY: Record<NetworkQuality, number> = {
  unknown: -1,
  good: 0,
  fair: 1,
  poor: 2,
};

const LOSS_FAIR = 0.02;
const LOSS_POOR = 0.08;
const RTT_FAIR_MS = 150;
const RTT_POOR_MS = 300;

/** Tier for one smoothed reading. The worse of the two signals wins. */
export function classify(sample: NetworkSample): Exclude<NetworkQuality, "unknown"> {
  if (sample.lossFraction >= LOSS_POOR || sample.rttMs >= RTT_POOR_MS) return "poor";
  if (sample.lossFraction >= LOSS_FAIR || sample.rttMs >= RTT_FAIR_MS) return "fair";
  return "good";
}

export class AdaptiveBitrateController {
  private ceiling: number;
  private floor: number;
  private readonly smoothing: number;
  private readonly downgradeAfter: number;
  private readonly upgradeAfter: number;
  private readonly minRelativeChange: number;

  private smoothed: NetworkSample | null = null;
  private quality: NetworkQuality = "unknown";
  /** The tier the recent samples point at, and how many in a row have. */
  private candidate: NetworkQuality = "unknown";
  private streak = 0;
  private current: number;

  constructor(options: AdaptiveBitrateOptions) {
    this.ceiling = Math.max(1, options.ceiling);
    this.floor = Math.min(options.floor, this.ceiling);
    this.smoothing = options.smoothing ?? 0.3;
    this.downgradeAfter = options.downgradeAfter ?? 2;
    this.upgradeAfter = options.upgradeAfter ?? 5;
    this.minRelativeChange = options.minRelativeChange ?? 0.1;
    this.current = this.ceiling;
  }

  getBitrate(): number {
    return this.current;
  }

  getQuality(): NetworkQuality {
    return this.quality;
  }

  /** Smoothed values, for the diagnostics readout. */
  getSample(): NetworkSample | null {
    return this.smoothed;
  }

  /** The bounds currently honoured, so a caller can assert them. */
  getBounds(): { ceiling: number; floor: number } {
    return { ceiling: this.ceiling, floor: this.floor };
  }

  /**
   * Switch profile without discarding what is known about the link.
   *
   * Both bounds move together and are stored, because `observe` clamps against
   * them for the rest of the session: keeping the previous profile's floor would
   * hold clarity at economy's floor, or pin economy above its own ceiling so a
   * poor link could not back off. An omitted floor is kept, but never above the
   * new ceiling.
   */
  setCeiling(ceiling: number, floor?: number): void {
    this.ceiling = Math.max(1, ceiling);
    this.floor = Math.min(floor ?? this.floor, this.ceiling);
    this.current = this.targetFor(this.quality);
  }

  reset(): void {
    this.smoothed = null;
    this.quality = "unknown";
    this.candidate = "unknown";
    this.streak = 0;
    this.current = this.ceiling;
  }

  observe(sample: NetworkSample): BitrateDecision {
    const loss = clamp(sample.lossFraction, 0, 1);
    const rtt = Math.max(0, sample.rttMs);
    const previous = this.smoothed;
    this.smoothed = previous
      ? {
          lossFraction: smooth(previous.lossFraction, loss, this.smoothing),
          rttMs: smooth(previous.rttMs, rtt, this.smoothing),
        }
      : { lossFraction: loss, rttMs: rtt };

    const observed = classify(this.smoothed);
    if (observed === this.quality) {
      this.candidate = observed;
      this.streak = 0;
      return this.unchanged();
    }

    if (observed !== this.candidate) {
      this.candidate = observed;
      this.streak = 0;
    }
    this.streak += 1;

    // Trouble is believed quickly; recovery has to earn it, because a link that
    // just misbehaved will usually do it again.
    const confirmations =
      SEVERITY[observed] > SEVERITY[this.quality] ? this.downgradeAfter : this.upgradeAfter;
    if (this.streak < confirmations) return this.unchanged();

    this.quality = observed;
    this.streak = 0;

    const target = this.targetFor(observed);
    // A 3% nudge is not worth renegotiating the encoder over.
    if (Math.abs(target - this.current) / this.current < this.minRelativeChange) {
      return this.unchanged();
    }

    this.current = target;
    return { bitrate: target, quality: observed, changed: true };
  }

  private unchanged(): BitrateDecision {
    return { bitrate: this.current, quality: this.quality, changed: false };
  }

  private targetFor(quality: NetworkQuality): number {
    return clamp(Math.round(this.ceiling * TIER_FACTOR[quality]), this.floor, this.ceiling);
  }
}

function smooth(previous: number, next: number, weight: number): number {
  return previous + (next - previous) * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
