"use client";

import { getAndroidCallBridge } from "@/lib/android/callBridge";

const CALL_ACTION_EVENT = "stellarr:android-call-action";
const PERMISSION_EVENT = "stellarr:android-notification-permission";

export type AndroidNotificationPermission = NotificationPermission | "unsupported";

export interface AndroidCallAction {
  action: "answer" | "decline";
  conversationId: string;
  callId: string;
}

// Every call goes through the bridge object itself rather than a detached
// method: on a real device the native methods fail when `this` is lost.

export function androidNotificationsSupported(): boolean {
  try {
    return getAndroidCallBridge()?.notificationsSupported?.() === true;
  } catch {
    return false;
  }
}

export function androidNotificationPermission(): AndroidNotificationPermission {
  try {
    const permission = getAndroidCallBridge()?.notificationPermission?.();
    return permission === "granted" || permission === "denied" || permission === "default"
      ? permission
      : "unsupported";
  } catch {
    return "unsupported";
  }
}

/** Resolves once the user has answered the native dialog. */
export function requestAndroidNotificationPermission(): Promise<NotificationPermission> {
  const bridge = getAndroidCallBridge();
  const current = androidNotificationPermission();
  if (current === "unsupported") return Promise.resolve("denied");
  if (current !== "default") return Promise.resolve(current);
  if (typeof bridge?.requestNotificationPermission !== "function") {
    return Promise.resolve("denied");
  }

  return new Promise((resolve) => {
    const onAnswered = () => {
      const answer = androidNotificationPermission();
      resolve(answer === "unsupported" ? "denied" : answer);
    };
    window.addEventListener(PERMISSION_EVENT, onAnswered, { once: true });
    try {
      bridge.requestNotificationPermission?.();
    } catch {
      window.removeEventListener(PERMISSION_EVENT, onAnswered);
      resolve("denied");
    }
  });
}

export function showAndroidIncomingCall(
  conversationId: string,
  callId: string,
  caller: string,
  body: string,
): boolean {
  if (androidNotificationPermission() !== "granted") return false;

  try {
    const bridge = getAndroidCallBridge();
    if (typeof bridge?.showIncomingCall !== "function") return false;
    bridge.showIncomingCall(conversationId, callId, caller, body);
    return true;
  } catch {
    return false;
  }
}

export function closeAndroidIncomingCall(callId: string): void {
  try {
    getAndroidCallBridge()?.hideIncomingCall?.(callId);
  } catch {
    // The in-app call flow stays authoritative when the native surface fails.
  }
}

function parseCallAction(raw: string | undefined): AndroidCallAction | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { action, conversationId, callId } = parsed as Record<string, unknown>;
    if (
      (action !== "answer" && action !== "decline") ||
      typeof conversationId !== "string" ||
      typeof callId !== "string"
    ) {
      return null;
    }
    return { action, conversationId, callId };
  } catch {
    return null;
  }
}

/**
 * Delivers the answer and decline buttons of the lock-screen notification.
 * An activity started from a cold start keeps the tapped action in native
 * memory, so it is also read once as soon as a subscriber appears.
 */
export function subscribeAndroidCallActions(
  listener: (action: AndroidCallAction) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const deliverPendingAction = () => {
    let raw: string | undefined;
    try {
      raw = getAndroidCallBridge()?.consumeCallAction?.();
    } catch {
      return;
    }
    const action = parseCallAction(raw);
    if (action !== null) listener(action);
  };

  window.addEventListener(CALL_ACTION_EVENT, deliverPendingAction);
  deliverPendingAction();
  return () => window.removeEventListener(CALL_ACTION_EVENT, deliverPendingAction);
}
