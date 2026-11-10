import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LifecycleWatcher, RecoveryWatchdog } from "./lifecycle";

const GRACE = 1000;

function watchdog(maxAttempts = 3) {
  const onEscalate = vi.fn();
  const dog = new RecoveryWatchdog({ graceMs: GRACE, maxAttempts, onEscalate });
  return { dog, onEscalate };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RecoveryWatchdog", () => {
  it("waits out the grace period before the first attempt", () => {
    const { dog, onEscalate } = watchdog();
    dog.arm();

    vi.advanceTimersByTime(GRACE - 1);
    // ICE very often recovers unaided; intervening early throws that away.
    expect(onEscalate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(1);
  });

  it("chains all three attempts while the peer stays unhealthy", () => {
    // Regression: escalation used to need an external `arm()` per attempt, but
    // `arm()` is driven by connectionstatechange — and a peer stuck in
    // `disconnected` fires no further events. maxAttempts was really one.
    const { dog, onEscalate } = watchdog(3);
    dog.arm();

    vi.advanceTimersByTime(GRACE);
    expect(onEscalate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(GRACE);
    expect(onEscalate).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(GRACE);
    expect(onEscalate).toHaveBeenCalledTimes(3);
    expect(onEscalate.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  it("counts an immediate hard-failure attempt inside the same budget", () => {
    const { dog, onEscalate } = watchdog(3);

    dog.arm(true);
    dog.arm(true);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenLastCalledWith(1);

    vi.advanceTimersByTime(GRACE * 2);
    expect(onEscalate).toHaveBeenCalledTimes(3);
    expect(onEscalate.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  it("turns a pending disconnect grace into one immediate failed attempt", () => {
    const { dog, onEscalate } = watchdog(3);
    dog.arm();
    vi.advanceTimersByTime(GRACE / 2);

    dog.arm(true);

    expect(onEscalate).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(GRACE / 2);
    expect(onEscalate).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(GRACE / 2);
    expect(onEscalate).toHaveBeenCalledTimes(2);
  });

  it("does not schedule another attempt after synchronous recovery", () => {
    const onEscalate = vi.fn();
    const dog = new RecoveryWatchdog({
      graceMs: GRACE,
      maxAttempts: 3,
      onEscalate: (attempt) => {
        onEscalate(attempt);
        dog.disarm();
      },
    });

    dog.arm(true);
    vi.advanceTimersByTime(GRACE * 5);

    expect(onEscalate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops at maxAttempts and schedules nothing further", () => {
    const { dog, onEscalate } = watchdog(3);
    dog.arm();
    vi.advanceTimersByTime(GRACE * 3);
    expect(dog.exhausted).toBe(true);
    expect(dog.armed).toBe(false);

    // No unbounded timer left behind.
    vi.advanceTimersByTime(GRACE * 50);
    expect(onEscalate).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports exhaustion only after the final restart gets a grace window", () => {
    const onExhausted = vi.fn();
    const dog = new RecoveryWatchdog({
      graceMs: GRACE,
      maxAttempts: 2,
      onEscalate: vi.fn(),
      onExhausted,
    });
    dog.arm();

    vi.advanceTimersByTime(GRACE * 2);
    expect(onExhausted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GRACE);
    expect(onExhausted).toHaveBeenCalledOnce();
  });

  it("refuses to restart once exhausted", () => {
    const { dog, onEscalate } = watchdog(2);
    dog.arm();
    vi.advanceTimersByTime(GRACE * 2);
    expect(onEscalate).toHaveBeenCalledTimes(2);

    dog.arm();
    vi.advanceTimersByTime(GRACE * 5);
    expect(onEscalate).toHaveBeenCalledTimes(2);
  });

  it("cancels mid-chain when the peer recovers", () => {
    const { dog, onEscalate } = watchdog(3);
    dog.arm();
    vi.advanceTimersByTime(GRACE);
    expect(onEscalate).toHaveBeenCalledTimes(1);

    dog.disarm();

    vi.advanceTimersByTime(GRACE * 10);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives a recovered peer a full fresh budget", () => {
    const { dog, onEscalate } = watchdog(3);
    dog.arm();
    vi.advanceTimersByTime(GRACE * 2);
    dog.disarm();
    expect(dog.attemptCount).toBe(0);

    dog.arm();
    vi.advanceTimersByTime(GRACE * 3);
    // Two before the recovery, three after.
    expect(onEscalate).toHaveBeenCalledTimes(5);
  });

  it("does not start a second chain while one is already running", () => {
    const { dog, onEscalate } = watchdog(3);
    dog.arm();
    // Repeated `disconnected` events must not double the cadence.
    dog.arm();
    dog.arm();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(GRACE);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stops everything on dispose without clearing history", () => {
    const { dog, onEscalate } = watchdog(3);
    dog.arm();
    vi.advanceTimersByTime(GRACE);
    expect(onEscalate).toHaveBeenCalledTimes(1);

    dog.dispose();

    vi.advanceTimersByTime(GRACE * 10);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    // The peer is gone, not recovered: the attempt is still on the record.
    expect(dog.attemptCount).toBe(1);
  });

  it("never arms with a zero budget", () => {
    const { dog, onEscalate } = watchdog(0);
    dog.arm();
    vi.advanceTimersByTime(GRACE * 10);
    expect(onEscalate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("LifecycleWatcher", () => {
  it("reports each signal once and removes its listeners on stop", () => {
    const onResume = vi.fn();
    const watcher = new LifecycleWatcher({ onResume });
    watcher.start();

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
    expect(onResume.mock.calls.map(([reason]) => reason)).toEqual([
      "visible",
      "pageshow",
      "online",
    ]);

    watcher.stop();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(onResume).toHaveBeenCalledTimes(3);
  });

  it("is idempotent, so a double start cannot double-subscribe", () => {
    const onResume = vi.fn();
    const watcher = new LifecycleWatcher({ onResume });
    watcher.start();
    watcher.start();

    window.dispatchEvent(new Event("online"));
    expect(onResume).toHaveBeenCalledTimes(1);
    watcher.stop();
  });
});
