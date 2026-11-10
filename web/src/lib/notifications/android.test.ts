import { afterEach, describe, expect, it, vi } from "vitest";

import {
  androidNotificationPermission,
  androidNotificationsSupported,
  closeAndroidIncomingCall,
  requestAndroidNotificationPermission,
  showAndroidIncomingCall,
  subscribeAndroidCallActions,
} from "./android";

afterEach(() => {
  delete window.StellarrAndroidCall;
});

describe("Android notification bridge", () => {
  it("exposes native support and forwards an incoming call", () => {
    const showIncomingCall = vi.fn();
    window.StellarrAndroidCall = {
      notificationsSupported: () => true,
      notificationPermission: () => "granted",
      showIncomingCall,
    };

    expect(androidNotificationsSupported()).toBe(true);
    expect(androidNotificationPermission()).toBe("granted");
    expect(showAndroidIncomingCall("dm-1", "call-1", "Ada", "Dzwoni")).toBe(true);
    expect(showIncomingCall).toHaveBeenCalledWith(
      "dm-1",
      "call-1",
      "Ada",
      "Dzwoni",
    );
  });

  it("waits for Android's permission result", async () => {
    let permission = "default";
    window.StellarrAndroidCall = {
      notificationsSupported: () => true,
      notificationPermission: () => permission,
      requestNotificationPermission: () => {
        permission = "granted";
        window.dispatchEvent(
          new Event("stellarr:android-notification-permission"),
        );
      },
    };

    await expect(requestAndroidNotificationPermission()).resolves.toBe("granted");
  });

  it("consumes answer and decline actions delivered by the activity", () => {
    const listener = vi.fn();
    const consumeCallAction = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify({
        action: "answer",
        conversationId: "dm-1",
        callId: "call-1",
      }))
      .mockReturnValue("");
    window.StellarrAndroidCall = { consumeCallAction };

    const unsubscribe = subscribeAndroidCallActions(listener);
    window.dispatchEvent(new Event("stellarr:android-call-action"));
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      action: "answer",
      conversationId: "dm-1",
      callId: "call-1",
    });
  });

  it("closes the exact native call surface", () => {
    const hideIncomingCall = vi.fn();
    window.StellarrAndroidCall = { hideIncomingCall };

    closeAndroidIncomingCall("call-1");

    expect(hideIncomingCall).toHaveBeenCalledWith("call-1");
  });
});
