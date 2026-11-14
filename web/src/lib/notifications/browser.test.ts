import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeIncomingCallNotification,
  incomingCallNotificationTag,
  messageNotificationTag,
  requestBrowserNotificationPermission,
  resetNotificationWorkerForTests,
  showIncomingCallNotification,
  showMessageNotification,
} from "./browser";

const originalNotification = Object.getOwnPropertyDescriptor(window, "Notification");

function installPlatform(permission: NotificationPermission = "granted") {
  const instances: NotificationMock[] = [];
  const requestPermission = vi.fn(async () => permission);
  class NotificationMock {
    static permission = permission;
    static requestPermission = requestPermission;
    readonly close = vi.fn(() => this.onclose?.(new Event("close")));
    onclick: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;

    constructor(readonly title: string, readonly options?: NotificationOptions) {
      instances.push(this);
    }
  }
  Object.defineProperty(window, "Notification", {
    value: NotificationMock,
    configurable: true,
  });
  return { instances, requestPermission };
}

afterEach(() => {
  resetNotificationWorkerForTests();
  if (originalNotification === undefined) Reflect.deleteProperty(window, "Notification");
  else Object.defineProperty(window, "Notification", originalNotification);
});

describe("browser notifications", () => {
  it("requests permission without registering a service worker", async () => {
    const { requestPermission } = installPlatform("granted");

    await expect(requestBrowserNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("uses a stable call tag so one ringing call cannot duplicate", async () => {
    const { instances } = installPlatform("granted");

    await expect(showIncomingCallNotification({
      id: "call-1",
      caller: "Ada",
      body: "Dzwoni do Ciebie",
    })).resolves.toBe(true);

    expect(instances).toHaveLength(1);
    expect(instances[0]?.title).toBe("Ada");
    expect(instances[0]?.options).toMatchObject({ tag: incomingCallNotificationTag("call-1") });
  });

  it("closes the system surface when the call ends", async () => {
    const { instances } = installPlatform("granted");
    await showIncomingCallNotification({ id: "call-1", caller: "Ada", body: "Dzwoni" });

    await closeIncomingCallNotification("call-1");

    expect(instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("does not show anything before permission is granted", async () => {
    const { instances } = installPlatform("default");

    await expect(showIncomingCallNotification({
      id: "call-1",
      caller: "Ada",
      body: "Dzwoni do Ciebie",
    })).resolves.toBe(false);
    expect(instances).toHaveLength(0);
  });

  it("pops a message up once under its own tag and opens it when pressed", () => {
    const { instances } = installPlatform("granted");
    const onOpen = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);

    expect(showMessageNotification({
      id: "m-1",
      title: "Nils oznacza Cię na #projekt",
      body: "@ada spójrz",
      onOpen,
    })).toBe(true);
    expect(instances[0]?.options).toMatchObject({
      body: "@ada spójrz",
      tag: messageNotificationTag("m-1"),
    });
    expect(instances[0]?.options?.requireInteraction).toBeUndefined();

    instances[0]?.onclick?.(new Event("click"));

    expect(focus).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(instances[0]?.close).toHaveBeenCalledOnce();
    focus.mockRestore();
  });

  it("does not pop a message up before permission is granted", () => {
    const { instances } = installPlatform("denied");

    expect(showMessageNotification({ id: "m-1", title: "Nils", body: "hej" })).toBe(false);
    expect(instances).toHaveLength(0);
  });
});
