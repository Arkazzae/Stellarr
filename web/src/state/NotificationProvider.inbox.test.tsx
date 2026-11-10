import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type {
  InboxNotification,
  NotificationInboxChangedEvent,
  NotificationPage,
  NotificationPort,
} from "@/ports";

import { NotificationProvider, useNotificationContext } from "./NotificationProvider";

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

function row(sequence: number, read = false): InboxNotification {
  return {
    id: `n-${sequence}`,
    sequence,
    title: `Title ${sequence}`,
    body: "Body",
    tone: "info",
    source: {
      type: "system",
      packageId: "stellarr",
      packageName: "Stellarr",
      moduleId: "inbox",
      moduleName: "Inbox",
    },
    createdAt: "2026-08-23T12:00:00.000Z",
    ...(read ? { readAt: "2026-08-23T12:05:00.000Z" } : {}),
  };
}

function page(items: InboxNotification[], overrides: Partial<NotificationPage> = {}): NotificationPage {
  return {
    items,
    nextBeforeSequence: null,
    unreadCount: items.filter((item) => item.readAt === undefined).length,
    lastSequence: items[0]?.sequence ?? 0,
    ...overrides,
  };
}

let changed: ((event: NotificationInboxChangedEvent) => void) | undefined;

function Probe() {
  const inbox = useNotificationContext();
  return (
    <div>
      <output aria-label="ids">{inbox.items.map((item) => item.id).join(",") || "empty"}</output>
      <output aria-label="unread">{inbox.unreadCount}</output>
      <output aria-label="loading">{String(inbox.loading)}</output>
      <output aria-label="older">{String(inbox.hasOlder)}</output>
      <output aria-label="error">{inbox.error ?? "none"}</output>
      <button type="button" onClick={() => void inbox.markRead("n-2")}>Read</button>
      <button type="button" onClick={() => void inbox.remove("n-2")}>Remove</button>
      <button type="button" onClick={() => void inbox.loadOlder()}>Older</button>
      <button type="button" onClick={inbox.reload}>Reload</button>
    </div>
  );
}

function mount(port: Partial<NotificationPort>) {
  changed = undefined;
  harness.notifications = {
    list: vi.fn(async () => page([])),
    markRead: vi.fn(async (id: string) => row(Number(id.slice(2)), true)),
    markAllRead: vi.fn(async () => 0),
    delete: vi.fn(async () => {}),
    onChanged: vi.fn((listener) => {
      changed = listener;
      return () => {};
    }),
    ...port,
  };
  render(
    <NotificationProvider>
      <Probe />
    </NotificationProvider>,
  );
  return harness.notifications;
}

const ids = () => screen.getByLabelText("ids");
const unread = () => screen.getByLabelText("unread");

beforeEach(() => {
  harness.serverId = "server-a";
});

describe("NotificationProvider inbox", () => {
  it("shows the first page and the unread count of the whole inbox", async () => {
    mount({ list: vi.fn(async () => page([row(2), row(1, true)], { unreadCount: 7 })) });

    await waitFor(() => expect(ids()).toHaveTextContent("n-2,n-1"));

    expect(unread()).toHaveTextContent("7");
    expect(screen.getByLabelText("loading")).toHaveTextContent("false");
  });

  it("marks one row read and lowers the count only for an unread row", async () => {
    const port = mount({ list: vi.fn(async () => page([row(2), row(1)])) });
    await waitFor(() => expect(unread()).toHaveTextContent("2"));

    await userEvent.click(screen.getByRole("button", { name: "Read" }));

    await waitFor(() => expect(unread()).toHaveTextContent("1"));
    expect(port.markRead).toHaveBeenCalledWith("n-2");

    await userEvent.click(screen.getByRole("button", { name: "Read" }));
    await waitFor(() => expect(port.markRead).toHaveBeenCalledTimes(2));
    expect(unread()).toHaveTextContent("1");
  });

  it("removes a row and lowers the count when the row was unread", async () => {
    mount({ list: vi.fn(async () => page([row(2), row(1)])) });
    await waitFor(() => expect(ids()).toHaveTextContent("n-2,n-1"));

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(ids()).toHaveTextContent("n-1"));
    expect(unread()).toHaveTextContent("1");
  });

  it("appends an older page without repeating a row it already has", async () => {
    const list = vi
      .fn<NotificationPort["list"]>()
      .mockResolvedValueOnce(page([row(3), row(2)], { nextBeforeSequence: 2, unreadCount: 3 }))
      .mockResolvedValueOnce(page([row(2), row(1)], { nextBeforeSequence: null, unreadCount: 3 }));
    mount({ list });
    await waitFor(() => expect(screen.getByLabelText("older")).toHaveTextContent("true"));

    await userEvent.click(screen.getByRole("button", { name: "Older" }));

    await waitFor(() => expect(ids()).toHaveTextContent("n-3,n-2,n-1"));
    expect(list).toHaveBeenLastCalledWith({ beforeSequence: 2, limit: 30 });
    expect(screen.getByLabelText("older")).toHaveTextContent("false");
  });

  it("does not ask for an older page when there is none", async () => {
    const port = mount({ list: vi.fn(async () => page([row(1)])) });
    await waitFor(() => expect(ids()).toHaveTextContent("n-1"));

    await userEvent.click(screen.getByRole("button", { name: "Older" }));

    expect(port.list).toHaveBeenCalledTimes(1);
  });

  it("reloads when the hub announces a change for this server or an invitation", async () => {
    const port = mount({ list: vi.fn(async () => page([row(1)])) });
    await waitFor(() => expect(ids()).toHaveTextContent("n-1"));

    act(() => changed?.({ serverId: "server-other" }));
    expect(port.list).toHaveBeenCalledTimes(1);

    act(() => changed?.({ serverId: "server-a" }));
    await waitFor(() => expect(port.list).toHaveBeenCalledTimes(2));

    act(() => changed?.({ serverId: "server-other", global: true }));
    await waitFor(() => expect(port.list).toHaveBeenCalledTimes(3));
  });

  it("keeps the rows on screen while a refresh runs", async () => {
    let finishRefresh!: (value: NotificationPage) => void;
    const refresh = new Promise<NotificationPage>((resolve) => {
      finishRefresh = resolve;
    });
    const list = vi
      .fn<NotificationPort["list"]>()
      .mockResolvedValueOnce(page([row(1)]))
      .mockReturnValueOnce(refresh);
    mount({ list });
    await waitFor(() => expect(ids()).toHaveTextContent("n-1"));

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(ids()).toHaveTextContent("n-1");
    expect(screen.getByLabelText("loading")).toHaveTextContent("false");
    finishRefresh(page([row(2), row(1)]));
    await waitFor(() => expect(ids()).toHaveTextContent("n-2,n-1"));
  });

  it("reports a failed load with the message of its kind", async () => {
    mount({
      list: vi.fn(async () => {
        throw new ApiError("network", "offline");
      }),
    });

    await waitFor(() => expect(screen.getByLabelText("error")).toHaveTextContent("session.network"));
    expect(screen.getByLabelText("loading")).toHaveTextContent("false");
  });

  it("reports a failed mutation and leaves the rows as they were", async () => {
    mount({
      list: vi.fn(async () => page([row(2), row(1)])),
      delete: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await waitFor(() => expect(ids()).toHaveTextContent("n-2,n-1"));

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.getByLabelText("error")).toHaveTextContent("notifications.loadFailed"),
    );
    expect(ids()).toHaveTextContent("n-2,n-1");
  });
});
