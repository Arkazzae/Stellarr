"use client";

/** What the Android shell exposes to the page as `window.StellarrAndroidCall`. */
export interface AndroidCallBridge {
  setActive?(active: boolean): void;
  notificationsSupported?(): boolean;
  notificationPermission?(): string;
  requestNotificationPermission?(): void;
  showIncomingCall?(
    conversationId: string,
    callId: string,
    caller: string,
    body: string,
  ): void;
  hideIncomingCall?(callId: string): void;
  consumeCallAction?(): string;
}

declare global {
  interface Window {
    StellarrAndroidCall?: AndroidCallBridge;
  }
}

/** The Android bridge, or `undefined` in a plain browser and on the server. */
export function getAndroidCallBridge(): AndroidCallBridge | undefined {
  return typeof window === "undefined" ? undefined : window.StellarrAndroidCall;
}
