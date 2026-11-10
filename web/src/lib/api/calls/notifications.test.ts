import { describe, expect, it } from "vitest";

import {
  itAnswersMissingDeletes,
  itForwardsTheSignal,
  jsonResponse,
  mockFetch,
  sentRequest,
} from "@/test/http";

import { notificationCalls } from "./notifications";

const fetchMock = mockFetch();
const calls = notificationCalls();

const ITEM = {
  id: "n-1",
  sequence: 8,
  title: "Release ready",
  body: "A release is ready to review.",
  tone: "success",
  source: { type: "system", packageId: "p", packageName: "P", moduleId: "m", moduleName: "M" },
  target: null,
  createdAt: "2026-08-23T12:00:00Z",
  readAt: null,
};

describe("notification calls", () => {
  it("lists the first page without a query string", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [ITEM], nextBeforeSequence: null, unreadCount: 1, lastSequence: 8 }),
    );

    await expect(calls.listNotifications()).resolves.toMatchObject({ unreadCount: 1 });

    expect(sentRequest(fetchMock).url).toBe("/api/notifications");
  });

  it("pages backwards from a sequence", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], nextBeforeSequence: null, unreadCount: 0, lastSequence: 8 }),
    );

    await calls.listNotifications({ beforeSequence: 8, limit: 30 });

    expect(sentRequest(fetchMock).url).toBe("/api/notifications?beforeSequence=8&limit=30");
  });

  it("marks one notification read and returns it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...ITEM, readAt: "2026-08-23T12:01:00Z" }));

    await expect(calls.markNotificationRead("n/1")).resolves.toMatchObject({
      readAt: "2026-08-23T12:01:00Z",
    });

    const sent = sentRequest(fetchMock);
    expect([sent.method, sent.url]).toEqual(["PUT", "/api/notifications/n%2F1/read"]);
  });

  it("resolves to how many notifications were marked read", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ changed: 3 }));

    await expect(calls.markAllNotificationsRead()).resolves.toBe(3);

    const sent = sentRequest(fetchMock);
    expect([sent.method, sent.url]).toEqual(["POST", "/api/notifications/read-all"]);
  });

  it("rejects a count that is not a whole number", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ changed: 1.5 }));
    await expect(calls.markAllNotificationsRead()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("deletes a notification", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await calls.deleteNotification("n-1");

    const sent = sentRequest(fetchMock);
    expect([sent.method, sent.url]).toEqual(["DELETE", "/api/notifications/n-1"]);
  });

  itAnswersMissingDeletes(
    fetchMock,
    { deleteNotification: () => calls.deleteNotification("n-1") },
    true,
  );

  itForwardsTheSignal(fetchMock, {
    deleteNotification: (signal) => calls.deleteNotification("n-1", signal),
  });
});
