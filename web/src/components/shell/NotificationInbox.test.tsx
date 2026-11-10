import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxNotification } from "@/ports";

import { NotificationInbox, type NotificationInboxProps } from "./NotificationInbox";

const NOTIFICATION: InboxNotification = {
  id: "notification-1",
  sequence: 8,
  title: "Release ready",
  body: "A release is ready to review.",
  tone: "success",
  source: {
    type: "sdk",
    packageId: "dev.stellarr.releases",
    packageName: "Releases",
    moduleId: "alerts",
    moduleName: "Alerts",
  },
  target: { type: "channel", channelId: "channel-1" },
  createdAt: "2026-08-23T12:00:00Z",
};

let anchor: HTMLButtonElement | null = null;

afterEach(() => {
  cleanup();
  anchor?.remove();
  anchor = null;
});

function inbox(overrides: Partial<NotificationInboxProps> = {}) {
  anchor = document.createElement("button");
  anchor.textContent = "Bell";
  document.body.append(anchor);
  const props: NotificationInboxProps = {
    items: [NOTIFICATION],
    unreadCount: 1,
    loading: false,
    loadingMore: false,
    hasOlder: true,
    error: null,
    anchor,
    onClose: vi.fn(),
    onReload: vi.fn(),
    onLoadOlder: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onDelete: vi.fn(),
    channelName: (channelId) => channelId === "channel-1" ? "general" : null,
    onOpenChannel: vi.fn(),
    ...overrides,
  };
  render(<NotificationInbox {...props} />);
  return props;
}

describe("notification inbox", () => {
  it("renders trusted rows and exposes every durable lifecycle action", async () => {
    const user = userEvent.setup();
    const props = inbox();

    expect(screen.getByRole("dialog", { name: "Powiadomienia" })).toBeTruthy();
    expect(screen.getByText("Release ready")).toBeTruthy();
    expect(screen.getByText("Releases · Alerts")).toBeTruthy();
    expect(screen.getByText("Nowe")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Oznacz jako przeczytane" }));
    expect(props.onMarkRead).toHaveBeenCalledWith("notification-1");
    await user.click(screen.getByRole("button", { name: "Otwórz #general" }));
    expect(props.onOpenChannel).toHaveBeenCalledWith("channel-1");
    expect(props.onMarkRead).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Usuń powiadomienie „Release ready”" }));
    expect(props.onDelete).toHaveBeenCalledWith("notification-1");
    await user.click(screen.getByRole("button", { name: "Przeczytaj wszystkie" }));
    expect(props.onMarkAllRead).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Pokaż starsze" }));
    expect(props.onLoadOlder).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps error recovery and empty history explicit", async () => {
    const user = userEvent.setup();
    const props = inbox({
      items: [],
      unreadCount: 0,
      hasOlder: false,
      error: "Nie można połączyć się z serwerem.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Nie można połączyć się z serwerem.");
    expect(screen.getByText("Nie masz powiadomień")).toBeTruthy();
    expect(screen.getByText(/trwałą historię/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(props.onReload).toHaveBeenCalledOnce();
  });

  it("renders and accepts a durable server invitation", async () => {
    const user = userEvent.setup();
    const onJoinInvite = vi.fn(async () => undefined);
    inbox({
      items: [{
        ...NOTIFICATION,
        id: "invite-1",
        source: {
          type: "system",
          packageId: "stellarr.server-invite",
          packageName: "Nebula",
          moduleId: "server-invite",
          moduleName: "Maja",
        },
        target: {
          type: "server-invite",
          inviteCode: "join-me",
          serverId: "server-2",
          serverName: "Nebula",
          invitedByName: "Maja",
        },
      }],
      onJoinInvite,
    });

    expect(screen.getByText("Zaproszenie na Nebula")).toBeTruthy();
    expect(screen.getByText("Maja zaprasza Cię na serwer Nebula.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dołącz do serwera" }));
    expect(onJoinInvite).toHaveBeenCalledWith("join-me");
  });

  it("announces loading without rendering stale empty copy", () => {
    inbox({ items: [], unreadCount: 0, loading: true, hasOlder: false });

    expect(screen.getByLabelText("Wczytywanie powiadomień")).toBeTruthy();
    expect(screen.queryByText("Nie masz powiadomień")).toBeNull();
  });
});
