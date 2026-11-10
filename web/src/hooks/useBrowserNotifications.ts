"use client";

import { useCallback, useEffect, useState } from "react";

import {
  androidNotificationPermission,
  androidNotificationsSupported,
  requestAndroidNotificationPermission,
} from "@/lib/notifications/android";
import {
  browserNotificationPermission,
  browserNotificationsSupported,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "@/lib/notifications/browser";

export interface BrowserNotificationsState {
  supported: boolean;
  permission: BrowserNotificationPermission;
  pending: boolean;
  error: boolean;
  request(): Promise<boolean>;
}

// Inside the Android app the native bridge owns notifications, and the web
// Notification API is not the one that rings, so the bridge wins when present.
function currentPermission(): BrowserNotificationPermission {
  return androidNotificationsSupported()
    ? androidNotificationPermission()
    : browserNotificationPermission();
}

/** Tracks the notification permission, including changes made in system or site settings. */
export function useBrowserNotifications(): BrowserNotificationsState {
  const [permission, setPermission] = useState(currentPermission);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  // Settings are changed outside the page, so look again when the user returns.
  useEffect(() => {
    const refresh = () => setPermission(currentPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const request = useCallback(async () => {
    setPending(true);
    setError(false);
    try {
      const answer = androidNotificationsSupported()
        ? await requestAndroidNotificationPermission()
        : await requestBrowserNotificationPermission();
      setPermission(answer);
      return answer === "granted";
    } catch {
      setError(true);
      setPermission(currentPermission());
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return {
    supported: androidNotificationsSupported() || browserNotificationsSupported(),
    permission,
    pending,
    error,
    request,
  };
}
