import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBrowserNotifications } from "./useBrowserNotifications";

const originalNotification = Object.getOwnPropertyDescriptor(window, "Notification");

/** Installs a Notification whose permission and answer a test controls. */
function installBrowserNotifications(permission: NotificationPermission) {
  const state = { permission };
  const requestPermission = vi.fn(async () => state.permission);
  class NotificationMock {
    static get permission() {
      return state.permission;
    }
    static requestPermission = requestPermission;
  }
  Object.defineProperty(window, "Notification", {
    value: NotificationMock,
    configurable: true,
  });
  return { state, requestPermission };
}

afterEach(() => {
  delete window.StellarrAndroidCall;
  if (originalNotification === undefined) Reflect.deleteProperty(window, "Notification");
  else Object.defineProperty(window, "Notification", originalNotification);
});

describe("without any notification support", () => {
  it("reports it as unsupported and denies a request", async () => {
    Reflect.deleteProperty(window, "Notification");
    const { result } = renderHook(() => useBrowserNotifications());

    expect(result.current).toMatchObject({ supported: false, permission: "unsupported" });

    let granted = true;
    await act(async () => {
      granted = await result.current.request();
    });

    expect(granted).toBe(false);
    expect(result.current.permission).toBe("denied");
  });
});

describe("in a browser", () => {
  it.each(["default", "granted", "denied"] as const)(
    "starts from the %s permission",
    (permission) => {
      installBrowserNotifications(permission);

      const { result } = renderHook(() => useBrowserNotifications());

      expect(result.current).toMatchObject({
        supported: true,
        permission,
        pending: false,
        error: false,
      });
    },
  );

  it("grants after the user accepts the prompt", async () => {
    const { state } = installBrowserNotifications("default");
    const { result } = renderHook(() => useBrowserNotifications());
    state.permission = "granted";

    let granted = false;
    await act(async () => {
      granted = await result.current.request();
    });

    expect(granted).toBe(true);
    expect(result.current.permission).toBe("granted");
  });

  it("stays denied after the user refuses the prompt", async () => {
    const { state } = installBrowserNotifications("default");
    const { result } = renderHook(() => useBrowserNotifications());
    state.permission = "denied";

    let granted = true;
    await act(async () => {
      granted = await result.current.request();
    });

    expect(granted).toBe(false);
    expect(result.current.permission).toBe("denied");
  });

  it("is pending while the prompt is open", async () => {
    const { requestPermission } = installBrowserNotifications("default");
    let answer: (permission: NotificationPermission) => void = () => undefined;
    requestPermission.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useBrowserNotifications());

    let request: Promise<boolean> = Promise.resolve(false);
    act(() => {
      request = result.current.request();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      answer("granted");
      await request;
    });
    expect(result.current.pending).toBe(false);
  });

  it("flags a failed request, then clears the flag on the next attempt", async () => {
    const { state, requestPermission } = installBrowserNotifications("default");
    requestPermission.mockRejectedValueOnce(new Error("blocked by policy"));
    const { result } = renderHook(() => useBrowserNotifications());

    let granted = true;
    await act(async () => {
      granted = await result.current.request();
    });
    expect(granted).toBe(false);
    expect(result.current).toMatchObject({ error: true, pending: false, permission: "default" });

    state.permission = "granted";
    await act(async () => {
      await result.current.request();
    });
    expect(result.current).toMatchObject({ error: false, permission: "granted" });
  });

  it("notices a change made in site settings when the window regains focus", () => {
    const { state } = installBrowserNotifications("granted");
    const { result } = renderHook(() => useBrowserNotifications());

    state.permission = "denied";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current.permission).toBe("denied");
  });

  it("notices a change made in site settings when the tab becomes visible", () => {
    const { state } = installBrowserNotifications("denied");
    const { result } = renderHook(() => useBrowserNotifications());

    state.permission = "granted";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.permission).toBe("granted");
  });

  it("stops watching for changes once unmounted", () => {
    const { state } = installBrowserNotifications("granted");
    const { result, unmount } = renderHook(() => useBrowserNotifications());
    unmount();

    state.permission = "denied";
    window.dispatchEvent(new Event("focus"));

    expect(result.current.permission).toBe("granted");
  });
});

describe("inside the Android app", () => {
  function installBridge(initial: string) {
    const state = { permission: initial };
    const requestNotificationPermission = vi.fn(() => {
      state.permission = "granted";
      window.dispatchEvent(new Event("stellarr:android-notification-permission"));
    });
    window.StellarrAndroidCall = {
      notificationsSupported: () => true,
      notificationPermission: () => state.permission,
      requestNotificationPermission,
    };
    return { state, requestNotificationPermission };
  }

  it("prefers the bridge over the browser API when both exist", async () => {
    const browser = installBrowserNotifications("denied");
    const { requestNotificationPermission } = installBridge("default");
    const { result } = renderHook(() => useBrowserNotifications());

    expect(result.current).toMatchObject({ supported: true, permission: "default" });

    let granted = false;
    await act(async () => {
      granted = await result.current.request();
    });

    expect(granted).toBe(true);
    expect(result.current.permission).toBe("granted");
    expect(requestNotificationPermission).toHaveBeenCalledOnce();
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });

  it("is supported through the bridge alone", () => {
    Reflect.deleteProperty(window, "Notification");
    installBridge("granted");

    const { result } = renderHook(() => useBrowserNotifications());

    expect(result.current).toMatchObject({ supported: true, permission: "granted" });
  });

  it("reads the bridge again when the app returns to the foreground", () => {
    const { state } = installBridge("default");
    const { result } = renderHook(() => useBrowserNotifications());

    state.permission = "denied";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current.permission).toBe("denied");
  });
});
