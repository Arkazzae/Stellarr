import type { ApiClient } from "../client";
import { expectRecord, expectSafeInteger } from "../expect";
import { parseInboxNotification, parseNotificationPage } from "../parsers";
import type { Parse } from "./http";
import { deleteResource, getJson, route, sendJson, withQuery } from "./http";

type NotificationCalls = Pick<
  ApiClient,
  | "listNotifications"
  | "markNotificationRead"
  | "markAllNotificationsRead"
  | "deleteNotification"
>;

const parseChangedCount: Parse<number> = (value, path) =>
  expectSafeInteger(expectRecord(value, path), "changed", path);

export function notificationCalls(): NotificationCalls {
  return {
    listNotifications: (options, signal) =>
      getJson(
        withQuery("/api/notifications", {
          beforeSequence: options?.beforeSequence,
          limit: options?.limit,
        }),
        parseNotificationPage,
        signal,
      ),

    markNotificationRead: (notificationId, signal) =>
      sendJson(
        "PUT",
        route`/api/notifications/${notificationId}/read`,
        undefined,
        parseInboxNotification,
        signal,
      ),

    markAllNotificationsRead: (signal) =>
      sendJson("POST", "/api/notifications/read-all", undefined, parseChangedCount, signal),

    deleteNotification: (notificationId, signal) =>
      deleteResource(route`/api/notifications/${notificationId}`, signal),
  };
}
