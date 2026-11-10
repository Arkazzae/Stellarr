import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import type { InboxNotification } from "@/ports";

import { NotificationInboxButton } from "./NotificationInboxContainer";

const mocks = vi.hoisted(() => ({
  inbox: {
    items: [] as InboxNotification[],
    unreadCount: 0,
    loading: false,
    loadingMore: false,
    hasOlder: false,
    error: null as string | null,
    reload: vi.fn(),
    loadOlder: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
  directory: {
    textChannels: [{ id: "channel-1", name: "general" }],
    joinInvite: vi.fn(),
    selectServer: vi.fn(),
  },
  ui: { selectTextChannel: vi.fn(), openServer: vi.fn() },
  session: { reload: vi.fn() },
}));

vi.mock("@/state/hooks", () => ({
  useNotifications: () => mocks.inbox,
  useDirectory: () => mocks.directory,
  useUi: () => mocks.ui,
  useSession: () => mocks.session,
  useLanguage: () => ({
    locale: "pl",
    t: (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values),
  }),
}));

const t = (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values);

const SOURCE = {
  type: "sdk",
  packageId: "dev.stellarr.releases",
  packageName: "Releases",
  moduleId: "alerts",
  moduleName: "Alerts",
} as const;

const CHANNEL_ROW: InboxNotification = {
  id: "n-1",
  sequence: 2,
  title: "Release ready",
  body: "Review it.",
  tone: "success",
  source: SOURCE,
  target: { type: "channel", channelId: "channel-1" },
  createdAt: "2026-08-23T12:00:00Z",
};

const INVITE_ROW: InboxNotification = {
  id: "n-2",
  sequence: 1,
  title: "Invitation",
  body: "",
  tone: "info",
  source: SOURCE,
  target: {
    type: "server-invite",
    inviteCode: "abc123",
    serverId: "srv-2",
    serverName: "Orbit",
    invitedByName: "Ada",
  },
  createdAt: "2026-08-23T11:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.inbox, {
    items: [CHANNEL_ROW, INVITE_ROW],
    unreadCount: 2,
    loading: false,
    error: null,
  });
});

function bell() {
  return screen.getByRole("button", { name: /Otwórz powiadomienia/ });
}

describe("NotificationInboxButton", () => {
  it("names the bell after the unread count and caps the badge", () => {
    mocks.inbox.unreadCount = 140;
    render(<NotificationInboxButton />);

    expect(bell()).toHaveAccessibleName(t("notifications.openUnread", { count: 140 }));
    expect(bell()).toHaveTextContent("99+");
  });

  it("shows neither a badge nor a count when everything is read", () => {
    mocks.inbox.unreadCount = 0;
    render(<NotificationInboxButton />);

    expect(bell()).toHaveAccessibleName(t("notifications.open"));
    expect(bell().textContent).toBe("");
  });

  it("opens the inbox on the bell and closes it on a second press", async () => {
    const user = userEvent.setup();
    render(<NotificationInboxButton />);

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(bell());
    expect(screen.getByRole("dialog", { name: t("notifications.title") })).toBeInTheDocument();
    expect(bell()).toHaveAttribute("aria-expanded", "true");

    await user.click(bell());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the channel a row points to and closes the inbox", async () => {
    const user = userEvent.setup();
    render(<NotificationInboxButton />);
    await user.click(bell());

    await user.click(screen.getByRole("button", { name: t("notifications.openChannel", { channel: "general" }) }));

    expect(mocks.ui.selectTextChannel).toHaveBeenCalledExactlyOnceWith("channel-1");
    expect(mocks.inbox.markRead).toHaveBeenCalledWith("n-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("joins the invited server, switches to it and reloads the session", async () => {
    const user = userEvent.setup();
    mocks.directory.joinInvite.mockResolvedValue({ id: "srv-2" });
    render(<NotificationInboxButton />);
    await user.click(bell());

    await user.click(screen.getByRole("button", { name: t("notifications.inviteJoin") }));

    await waitFor(() => expect(mocks.session.reload).toHaveBeenCalledOnce());
    expect(mocks.directory.joinInvite).toHaveBeenCalledExactlyOnceWith("abc123");
    expect(mocks.directory.selectServer).toHaveBeenCalledExactlyOnceWith("srv-2");
    expect(mocks.ui.openServer).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the inbox open and leaves the session alone when the invite fails", async () => {
    const user = userEvent.setup();
    mocks.directory.joinInvite.mockRejectedValue(new Error("expired"));
    render(<NotificationInboxButton />);
    await user.click(bell());

    await user.click(screen.getByRole("button", { name: t("notifications.inviteJoin") }));

    await waitFor(() => expect(mocks.directory.joinInvite).toHaveBeenCalled());
    expect(mocks.directory.selectServer).not.toHaveBeenCalled();
    expect(mocks.session.reload).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
