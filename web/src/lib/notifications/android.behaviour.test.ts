import { afterEach, describe, expect, it, vi } from "vitest";

import {
  androidNotificationPermission,
  androidNotificationsSupported,
  closeAndroidIncomingCall,
  requestAndroidNotificationPermission,
  showAndroidIncomingCall,
  subscribeAndroidCallActions,
} from "./android";

const PERMISSION_EVENT = "stellarr:android-notification-permission";
const ACTION_EVENT = "stellarr:android-call-action";

afterEach(() => {
  delete window.StellarrAndroidCall;
});

const action = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ action: "answer", conversationId: "dm-1", callId: "call-1", ...overrides });

describe("in a plain browser", () => {
  it("reports no support and denies every request", async () => {
    expect(androidNotificationsSupported()).toBe(false);
    expect(androidNotificationPermission()).toBe("unsupported");
    expect(showAndroidIncomingCall("dm-1", "call-1", "Ada", "Dzwoni")).toBe(false);
    await expect(requestAndroidNotificationPermission()).resolves.toBe("denied");
    expect(() => closeAndroidIncomingCall("call-1")).not.toThrow();
  });
});

describe("a bridge that misbehaves", () => {
  it("treats an unknown permission string as unsupported", () => {
    window.StellarrAndroidCall = { notificationPermission: () => "maybe" };

    expect(androidNotificationPermission()).toBe("unsupported");
  });

  it("treats a throwing native method as unsupported", () => {
    const fail = () => {
      throw new Error("native failure");
    };
    window.StellarrAndroidCall = {
      notificationsSupported: fail,
      notificationPermission: fail,
      hideIncomingCall: fail,
      consumeCallAction: fail,
    };

    expect(androidNotificationsSupported()).toBe(false);
    expect(androidNotificationPermission()).toBe("unsupported");
    expect(() => closeAndroidIncomingCall("call-1")).not.toThrow();
    expect(() => subscribeAndroidCallActions(vi.fn())()).not.toThrow();
  });

  it("reports failure when the native call surface throws", () => {
    window.StellarrAndroidCall = {
      notificationPermission: () => "granted",
      showIncomingCall: () => {
        throw new Error("native failure");
      },
    };

    expect(showAndroidIncomingCall("dm-1", "call-1", "Ada", "Dzwoni")).toBe(false);
  });
});

describe("showing an incoming call", () => {
  it.each(["default", "denied"])("shows nothing while the permission is %s", (permission) => {
    const showIncomingCall = vi.fn();
    window.StellarrAndroidCall = { notificationPermission: () => permission, showIncomingCall };

    expect(showAndroidIncomingCall("dm-1", "call-1", "Ada", "Dzwoni")).toBe(false);
    expect(showIncomingCall).not.toHaveBeenCalled();
  });

  it("reports failure when the bridge has no way to show a call", () => {
    window.StellarrAndroidCall = { notificationPermission: () => "granted" };

    expect(showAndroidIncomingCall("dm-1", "call-1", "Ada", "Dzwoni")).toBe(false);
  });

  it("calls the bridge as a method of itself", () => {
    const receivers: unknown[] = [];
    const bridge = {
      notificationPermission: () => "granted",
      showIncomingCall(this: unknown) {
        receivers.push(this);
      },
    };
    window.StellarrAndroidCall = bridge;

    showAndroidIncomingCall("dm-1", "call-1", "Ada", "Dzwoni");

    expect(receivers).toEqual([bridge]);
  });
});

describe("requesting permission", () => {
  it("answers from the current state without asking again once decided", async () => {
    const requestNotificationPermission = vi.fn();
    window.StellarrAndroidCall = {
      notificationPermission: () => "granted",
      requestNotificationPermission,
    };

    await expect(requestAndroidNotificationPermission()).resolves.toBe("granted");
    expect(requestNotificationPermission).not.toHaveBeenCalled();
  });

  it("denies when an undecided bridge cannot ask", async () => {
    window.StellarrAndroidCall = { notificationPermission: () => "default" };

    await expect(requestAndroidNotificationPermission()).resolves.toBe("denied");
  });

  it("waits for the event, not for the call to return", async () => {
    let permission = "default";
    window.StellarrAndroidCall = {
      notificationPermission: () => permission,
      requestNotificationPermission: vi.fn(),
    };
    const settled = vi.fn();

    const request = requestAndroidNotificationPermission().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    permission = "denied";
    window.dispatchEvent(new Event(PERMISSION_EVENT));
    await request;

    expect(settled).toHaveBeenCalledWith("denied");
  });

  it("denies, and stops listening, when the bridge throws while asking", async () => {
    let permission = "default";
    window.StellarrAndroidCall = {
      notificationPermission: () => permission,
      requestNotificationPermission: () => {
        throw new Error("native failure");
      },
    };

    await expect(requestAndroidNotificationPermission()).resolves.toBe("denied");

    // A late event must not resolve anything or change what the next request sees.
    permission = "granted";
    window.dispatchEvent(new Event(PERMISSION_EVENT));
    await expect(requestAndroidNotificationPermission()).resolves.toBe("granted");
  });
});

describe("call actions from the lock screen", () => {
  it("delivers an action that was waiting before anyone subscribed", () => {
    const listener = vi.fn();
    window.StellarrAndroidCall = {
      consumeCallAction: vi.fn().mockReturnValueOnce(action({ action: "decline" })),
    };

    const unsubscribe = subscribeAndroidCallActions(listener);
    unsubscribe();

    expect(listener).toHaveBeenCalledWith({
      action: "decline",
      conversationId: "dm-1",
      callId: "call-1",
    });
  });

  it.each([
    ["an empty string", ""],
    ["text that is not JSON", "answer"],
    ["JSON that is not an object", "42"],
    ["null", "null"],
    ["an unknown action", action({ action: "snooze" })],
    ["a missing call id", action({ callId: undefined })],
    ["a numeric conversation id", action({ conversationId: 7 })],
  ])("ignores %s", (_label, raw) => {
    const listener = vi.fn();
    window.StellarrAndroidCall = { consumeCallAction: () => raw };

    subscribeAndroidCallActions(listener)();

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribing", () => {
    const listener = vi.fn();
    window.StellarrAndroidCall = { consumeCallAction: () => action() };
    const unsubscribe = subscribeAndroidCallActions(listener);
    expect(listener).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event(ACTION_EVENT));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event(ACTION_EVENT));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
