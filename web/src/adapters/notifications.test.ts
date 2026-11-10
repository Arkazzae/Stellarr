import { describe, expect, it, vi } from "vitest";

import { FakeRealtimeClient, fakeApi } from "@/test/fakes";

import { createNotificationAdapter } from "./notifications";

describe("notification adapter", () => {
  it("forwards the private inbox lifecycle and realtime invalidation", async () => {
    const page = {
      items: [],
      nextBeforeSequence: null,
      unreadCount: 2,
      lastSequence: 8,
    };
    const listNotifications = vi.fn(async () => page);
    const markAllNotificationsRead = vi.fn(async () => 2);
    const deleteNotification = vi.fn(async () => undefined);
    const api = fakeApi({
      listNotifications,
      markAllNotificationsRead,
      deleteNotification,
    });
    const realtime = new FakeRealtimeClient();
    const notifications = createNotificationAdapter(api, realtime);

    await expect(notifications.list({ beforeSequence: 9, limit: 30 })).resolves.toBe(page);
    await expect(notifications.markAllRead()).resolves.toBe(2);
    await notifications.delete("notification-1");
    expect(listNotifications).toHaveBeenCalledWith(
      { beforeSequence: 9, limit: 30 },
      undefined,
    );
    expect(deleteNotification).toHaveBeenCalledWith("notification-1", undefined);

    const changed = vi.fn();
    const unsubscribe = notifications.onChanged(changed);
    realtime.push("NotificationInboxChanged", { serverId: "server-1", sequence: 8 });
    expect(changed).toHaveBeenCalledWith({ serverId: "server-1", sequence: 8 });
    unsubscribe();
  });
});
