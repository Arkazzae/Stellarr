import type { ApiClient } from "@/lib/api/client";
import type { RealtimeClient } from "@/lib/realtime/types";
import type { NotificationPort } from "@/ports";

export function createNotificationAdapter(
  api: ApiClient,
  realtime: RealtimeClient,
): NotificationPort {
  return {
    list: (options, signal) => api.listNotifications(options, signal),
    markRead: (notificationId, signal) => api.markNotificationRead(notificationId, signal),
    markAllRead: (signal) => api.markAllNotificationsRead(signal),
    delete: (notificationId, signal) => api.deleteNotification(notificationId, signal),
    onChanged: (listener) => realtime.on("NotificationInboxChanged", listener),
  };
}
