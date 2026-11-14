export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export interface IncomingCallNotification {
  id: string;
  caller: string;
  body: string;
}

/** The notifications on screen, by call id, so a call can replace or close its own. */
const shown = new Map<string, Notification>();

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && typeof window.Notification === "function";
}

export function browserNotificationPermission(): BrowserNotificationPermission {
  return browserNotificationsSupported() ? window.Notification.permission : "unsupported";
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (!browserNotificationsSupported()) return "denied";
  return await window.Notification.requestPermission();
}

export function incomingCallNotificationTag(id: string): string {
  return `stellarr-incoming-call:${id}`;
}

/**
 * Rings for a call while the page is open but hidden, as on a phone.
 *
 * This is limited to a live page on purpose: delivery to an installed or
 * backgrounded app belongs to the native clients, not to the web application.
 */
export async function showIncomingCallNotification(
  call: IncomingCallNotification,
): Promise<boolean> {
  if (browserNotificationPermission() !== "granted") return false;

  try {
    shown.get(call.id)?.close();
    const notification = new window.Notification(call.caller, {
      body: call.body,
      // The tag makes the system replace a notification instead of stacking one.
      tag: incomingCallNotificationTag(call.id),
      icon: "/icon.svg",
      requireInteraction: true,
      data: { url: "/", type: "incoming-call", callId: call.id },
    });
    shown.set(call.id, notification);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    notification.onclose = () => {
      if (shown.get(call.id) === notification) shown.delete(call.id);
    };
    return true;
  } catch {
    return false;
  }
}

export interface MessageNotification {
  /** The message's id: the same message never pops up twice. */
  id: string;
  title: string;
  body: string;
  /** Pressing the notification brings the window forward and calls this. */
  onOpen?: () => void;
}

export function messageNotificationTag(id: string): string {
  return `stellarr-message:${id}`;
}

/**
 * Pops a message up over other apps, as `showIncomingCallNotification` does a
 * call, and only for a live page. Unlike a call it goes away on its own.
 */
export function showMessageNotification(message: MessageNotification): boolean {
  if (browserNotificationPermission() !== "granted") return false;

  try {
    const notification = new window.Notification(message.title, {
      body: message.body,
      tag: messageNotificationTag(message.id),
      icon: "/icon.svg",
      data: { url: "/", type: "message", messageId: message.id },
    });
    notification.onclick = () => {
      window.focus();
      message.onOpen?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** The one a settings pane sends so the person sees what the others will look like. */
export function showTestNotification(title: string, body: string): boolean {
  return showMessageNotification({ id: "test", title, body });
}

export async function closeIncomingCallNotification(id: string): Promise<void> {
  shown.get(id)?.close();
  shown.delete(id);
}

/** Closes everything that is showing, so the next test starts clean. */
export function resetNotificationWorkerForTests(): void {
  for (const notification of shown.values()) notification.close();
  shown.clear();
}
