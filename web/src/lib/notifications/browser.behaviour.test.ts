import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserNotificationPermission,
  browserNotificationsSupported,
  closeIncomingCallNotification,
  requestBrowserNotificationPermission,
  resetNotificationWorkerForTests,
  showIncomingCallNotification,
} from "./browser";

const originalNotification = Object.getOwnPropertyDescriptor(window, "Notification");

const call = { id: "call-1", caller: "Ada", body: "Dzwoni" };

function installPlatform(permission: NotificationPermission, failing = false) {
  const instances: NotificationMock[] = [];
  class NotificationMock {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    readonly close = vi.fn(() => this.onclose?.(new Event("close")));
    onclick: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;

    constructor(readonly title: string, readonly options?: NotificationOptions) {
      if (failing) throw new TypeError("Illegal constructor");
      instances.push(this);
    }
  }
  Object.defineProperty(window, "Notification", { value: NotificationMock, configurable: true });
  return instances;
}

afterEach(() => {
  resetNotificationWorkerForTests();
  vi.restoreAllMocks();
  if (originalNotification === undefined) Reflect.deleteProperty(window, "Notification");
  else Object.defineProperty(window, "Notification", originalNotification);
});

describe("without the Notification API", () => {
  it("reports it as unsupported and shows nothing", async () => {
    Reflect.deleteProperty(window, "Notification");

    expect(browserNotificationsSupported()).toBe(false);
    expect(browserNotificationPermission()).toBe("unsupported");
    await expect(requestBrowserNotificationPermission()).resolves.toBe("denied");
    await expect(showIncomingCallNotification(call)).resolves.toBe(false);
  });
});

describe("showing an incoming call", () => {
  it("keeps the call visible until it is answered", async () => {
    const instances = installPlatform("granted");

    await showIncomingCallNotification(call);

    expect(instances[0]?.options).toMatchObject({
      body: "Dzwoni",
      requireInteraction: true,
      data: { type: "incoming-call", callId: "call-1" },
    });
  });

  it("replaces the earlier notification of the same call", async () => {
    const instances = installPlatform("granted");

    await showIncomingCallNotification(call);
    await showIncomingCallNotification({ ...call, body: "Dzwoni ponownie" });

    expect(instances).toHaveLength(2);
    expect(instances[0]?.close).toHaveBeenCalledOnce();
    expect(instances[1]?.close).not.toHaveBeenCalled();
  });

  it("keeps calls with different ids apart", async () => {
    const instances = installPlatform("granted");

    await showIncomingCallNotification(call);
    await showIncomingCallNotification({ ...call, id: "call-2" });

    expect(instances.map((instance) => instance.close.mock.calls.length)).toEqual([0, 0]);
  });

  it("brings the page forward and dismisses the notification when it is clicked", async () => {
    const instances = installPlatform("granted");
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    await showIncomingCallNotification(call);

    instances[0]?.onclick?.(new Event("click"));

    expect(focus).toHaveBeenCalledOnce();
    expect(instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("reports failure when the browser refuses to construct a notification", async () => {
    installPlatform("granted", true);

    await expect(showIncomingCallNotification(call)).resolves.toBe(false);
  });
});

describe("closing an incoming call", () => {
  it("closes a notification once, even if the call is closed again", async () => {
    const instances = installPlatform("granted");
    await showIncomingCallNotification(call);

    await closeIncomingCallNotification("call-1");
    await closeIncomingCallNotification("call-1");

    expect(instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("does nothing for a call that was never shown", async () => {
    installPlatform("granted");

    await expect(closeIncomingCallNotification("unknown")).resolves.toBeUndefined();
  });

  it("forgets a notification the user dismissed, so a new one is not closed in its place", async () => {
    const instances = installPlatform("granted");
    await showIncomingCallNotification(call);
    instances[0]?.onclose?.(new Event("close"));

    await showIncomingCallNotification(call);

    expect(instances[0]?.close).not.toHaveBeenCalled();
  });
});
