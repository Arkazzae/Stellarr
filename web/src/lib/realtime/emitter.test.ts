import { describe, expect, it, vi } from "vitest";
import { ChangeNotifier, Emitter } from "./emitter";

interface Events {
  greeted: { name: string };
  closed: undefined;
}

describe("Emitter", () => {
  it("delivers a payload to every handler of that event only", () => {
    const emitter = new Emitter<Events>();
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    emitter.on("greeted", first);
    emitter.on("greeted", second);
    emitter.on("closed", other);

    emitter.emit("greeted", { name: "Ada" });

    expect(first).toHaveBeenCalledWith({ name: "Ada" });
    expect(second).toHaveBeenCalledWith({ name: "Ada" });
    expect(other).not.toHaveBeenCalled();
  });

  it("does nothing when nobody listens", () => {
    expect(() => new Emitter<Events>().emit("closed", undefined)).not.toThrow();
  });

  it("stops delivering once a handler unsubscribes, leaving the others", () => {
    const emitter = new Emitter<Events>();
    const removed = vi.fn();
    const kept = vi.fn();
    const unsubscribe = emitter.on("greeted", removed);
    emitter.on("greeted", kept);

    unsubscribe();
    unsubscribe();
    emitter.emit("greeted", { name: "Ada" });

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("registers the same function once per event", () => {
    const emitter = new Emitter<Events>();
    const handler = vi.fn();
    emitter.on("greeted", handler);
    emitter.on("greeted", handler);

    emitter.emit("greeted", { name: "Ada" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits to the handlers present when the emit began", () => {
    const emitter = new Emitter<Events>();
    const late = vi.fn();
    const second = vi.fn();
    const unsubscribeSecond = emitter.on("closed", () => {
      unsubscribeSecond();
      emitter.on("closed", late);
    });
    emitter.on("closed", second);

    emitter.emit("closed", undefined);

    expect(second).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    emitter.emit("closed", undefined);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

describe("ChangeNotifier", () => {
  it("notifies every subscriber until it unsubscribes", () => {
    const notifier = new ChangeNotifier();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = notifier.subscribe(first);
    notifier.subscribe(second);

    notifier.notify();
    unsubscribeFirst();
    notifier.notify();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("can hand subscribe to a consumer without binding it", () => {
    const notifier = new ChangeNotifier();
    const { subscribe } = notifier;
    const listener = vi.fn();

    subscribe(listener);
    notifier.notify();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lets a listener unsubscribe during a notification without skipping the next", () => {
    const notifier = new ChangeNotifier();
    const next = vi.fn();
    const unsubscribe = notifier.subscribe(() => unsubscribe());
    notifier.subscribe(next);

    notifier.notify();

    expect(next).toHaveBeenCalledTimes(1);
  });
});
