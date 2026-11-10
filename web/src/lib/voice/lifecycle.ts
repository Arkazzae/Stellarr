/**
 * Page lifecycle signals that matter to a live call.
 *
 * A backgrounded tab is not a broken call, but it is where things quietly rot:
 * Chromium suspends the AudioContext, autoplay can stall a remote `<audio>`
 * element, and a network change while hidden leaves peers `disconnected` with
 * nothing to nudge them. All three are recoverable if something asks. This is
 * that something.
 *
 * It is deliberately not a reason to leave the channel: switching tabs is the
 * most ordinary thing a person does during a call.
 */
export type LifecycleReason = "visible" | "pageshow" | "online";

export interface LifecycleWatcherOptions {
  onResume: (reason: LifecycleReason) => void;
}

export class LifecycleWatcher {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: LifecycleWatcherOptions) {}

  /** Idempotent, so a double start cannot double-subscribe. */
  start(): void {
    if (this.unsubscribe || typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const { onResume } = this.options;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") onResume("visible");
    };
    const onPageShow = () => onResume("pageshow");
    const onOnline = () => onResume("online");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);

    this.unsubscribe = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

interface RecoveryWatchdogOptions {
  /** How long a peer may stay unhealthy before the next attempt. */
  graceMs: number;
  maxAttempts: number;
  /** Restart ICE; `attempt` counts from 1. */
  onEscalate: (attempt: number) => void;
  /** Called once the last attempt has had a full grace window and failed too. */
  onExhausted?: () => void;
}

/**
 * Bounded retry for a peer that has gone `disconnected`.
 *
 * `disconnected` is transient by design: a Wi-Fi handover or a sleeping tab
 * produces it routinely, and ICE very often recovers within seconds. Restarting
 * at once would throw away a connection that was about to come back, so the
 * watchdog waits, then escalates, then gives up instead of restarting forever.
 */
export class RecoveryWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(private readonly options: RecoveryWatchdogOptions) {}

  /**
   * Start the escalation chain unless one is already running.
   *
   * Each attempt schedules the next by itself. Waiting for another `arm()` does
   * not work, because `arm()` is driven by `connectionstatechange` and a peer
   * that stays `disconnected` fires no further events, which made `maxAttempts`
   * one attempt in practice. The chain stays strictly bounded: it stops at
   * `maxAttempts`, and `disarm()` cancels it as soon as the peer recovers.
   *
   * `immediate` is for a hard failure. It skips the grace timer that was armed
   * while the transport was merely disconnected, but only before any attempt
   * has run; after that, repeated failure events stay on the bounded cadence.
   */
  arm(immediate = false): void {
    if (this.timer !== null) {
      if (!immediate || this.attempts > 0) return;
      this.cancelTimer();
    }
    if (this.exhausted) return;

    if (immediate) this.escalate();
    else this.after(() => this.escalate());
  }

  /** True while an escalation, or the verdict after the last one, is pending. */
  get armed(): boolean {
    return this.timer !== null;
  }

  get exhausted(): boolean {
    return this.attempts >= this.options.maxAttempts;
  }

  get attemptCount(): number {
    return this.attempts;
  }

  /** The peer recovered: cancel the chain and forget the attempt history. */
  disarm(): void {
    this.cancelTimer();
    this.attempts = 0;
  }

  /** Cancel without clearing history: the peer is gone, not recovered. */
  dispose(): void {
    this.cancelTimer();
  }

  private escalate(): void {
    this.attempts += 1;
    const attempt = this.attempts;
    this.options.onEscalate(attempt);

    // The callback may recover the peer synchronously and disarm us.
    if (this.attempts !== attempt) return;

    if (!this.exhausted) {
      this.after(() => this.escalate());
    } else {
      // The final restart gets one whole grace window to settle before the
      // peer is declared lost.
      const { onExhausted } = this.options;
      if (onExhausted) this.after(onExhausted);
    }
  }

  private after(run: () => void): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, this.options.graceMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
