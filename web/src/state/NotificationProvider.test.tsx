import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  InboxNotification,
  NotificationPage,
  NotificationPort,
} from "@/ports";

import {
  NotificationProvider,
  useNotificationContext,
} from "./NotificationProvider";

const harness = vi.hoisted(() => ({
  serverId: "server-a",
  notifications: undefined as unknown as NotificationPort,
  t: (key: string) => key,
}));

vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => ({ server: { id: harness.serverId } }),
}));

vi.mock("./LanguageProvider", () => ({
  useLanguage: () => ({ t: harness.t }),
}));

vi.mock("./PortsProvider", () => ({
  usePorts: () => ({ notifications: harness.notifications }),
}));

const source: InboxNotification["source"] = {
  type: "sdk",
  packageId: "dev.stellarr.notifications",
  packageName: "Notifications",
  moduleId: "alerts",
  moduleName: "Alerts",
};

function notification(serverId: string): InboxNotification {
  return {
    id: `notification-${serverId}`,
    sequence: 1,
    title: `Notification for ${serverId}`,
    body: "Unread body",
    tone: "info",
    source,
    createdAt: "2026-08-23T12:00:00.000Z",
  };
}

function page(serverId: string): NotificationPage {
  return {
    items: [notification(serverId)],
    nextBeforeSequence: null,
    unreadCount: 1,
    lastSequence: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function Probe() {
  const value = useNotificationContext();
  return (
    <div>
      <output aria-label="notification-id">{value.items[0]?.id ?? "loading"}</output>
      <output aria-label="unread-count">{value.unreadCount}</output>
      <output aria-label="read-at">{value.items[0]?.readAt ?? "unread"}</output>
      <button type="button" onClick={() => void value.markAllRead()}>
        Mark all read
      </button>
    </div>
  );
}

describe("NotificationProvider", () => {
  beforeEach(() => {
    harness.serverId = "server-a";
  });

  it("does not apply a completed mutation after the active server changes", async () => {
    const markAll = deferred<number>();
    harness.notifications = {
      list: vi.fn(async () => page(harness.serverId)),
      markRead: vi.fn(async (notificationId) => notification(notificationId)),
      markAllRead: vi.fn(() => markAll.promise),
      delete: vi.fn(async () => {}),
      onChanged: vi.fn(() => () => {}),
    };

    const rendered = render(
      <NotificationProvider>
        <Probe />
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("notification-id"))
      .toHaveTextContent("notification-server-a"));

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(harness.notifications.markAllRead).toHaveBeenCalledOnce();
    harness.serverId = "server-b";
    rendered.rerender(
      <NotificationProvider>
        <Probe />
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("notification-id"))
      .toHaveTextContent("notification-server-b"));

    await act(async () => {
      markAll.resolve(1);
      await markAll.promise;
    });

    expect(screen.getByLabelText("unread-count")).toHaveTextContent("1");
    expect(screen.getByLabelText("read-at")).toHaveTextContent("unread");
  });
});
