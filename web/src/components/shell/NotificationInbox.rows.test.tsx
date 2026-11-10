import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxNotification } from "@/ports";

import { NotificationInbox, type NotificationInboxProps } from "./NotificationInbox";

const CHANNEL_ROW: InboxNotification = {
  id: "n-1",
  sequence: 4,
  title: "Deploy finished",
  body: "Production is up to date.",
  tone: "info",
  source: {
    type: "sdk",
    packageId: "dev.example.deploys",
    packageName: "Deploys",
    moduleId: "deploys",
    moduleName: "Deploys",
  },
  target: { type: "channel", channelId: "channel-1" },
  createdAt: "2026-08-23T12:00:00Z",
};

const INVITE_ROW: InboxNotification = {
  ...CHANNEL_ROW,
  id: "n-invite",
  source: { ...CHANNEL_ROW.source, type: "system", packageId: "stellarr.server-invite" },
  target: {
    type: "server-invite",
    inviteCode: "join-me",
    serverId: "server-2",
    serverName: "Nebula",
    invitedByName: "Maja",
  },
};

let anchor: HTMLButtonElement | null = null;

afterEach(() => {
  cleanup();
  anchor?.remove();
  anchor = null;
});

function inbox(overrides: Partial<NotificationInboxProps> = {}) {
  anchor = document.createElement("button");
  document.body.append(anchor);
  const props: NotificationInboxProps = {
    items: [CHANNEL_ROW],
    unreadCount: 1,
    loading: false,
    loadingMore: false,
    hasOlder: false,
    error: null,
    anchor,
    onClose: vi.fn(),
    onReload: vi.fn(),
    onLoadOlder: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onDelete: vi.fn(),
    channelName: () => "general",
    onOpenChannel: vi.fn(),
    ...overrides,
  };
  render(<NotificationInbox {...props} />);
  return props;
}

describe("notification rows", () => {
  it("offers no mark-read control on a row that has been read", () => {
    inbox({ items: [{ ...CHANNEL_ROW, readAt: "2026-08-23T12:05:00Z" }], unreadCount: 0 });

    expect(screen.queryByRole("button", { name: "Oznacz jako przeczytane" })).toBeNull();
    expect(screen.queryByText("Nowe")).toBeNull();
    expect(screen.queryByRole("button", { name: "Przeczytaj wszystkie" })).toBeNull();
    expect(screen.getByText("Wszystko przeczytane")).toBeInTheDocument();
  });

  it("does not mark a read row again when its channel is opened", async () => {
    const user = userEvent.setup();
    const props = inbox({
      items: [{ ...CHANNEL_ROW, readAt: "2026-08-23T12:05:00Z" }],
      unreadCount: 0,
    });

    await user.click(screen.getByRole("button", { name: "Otwórz #general" }));

    expect(props.onOpenChannel).toHaveBeenCalledWith("channel-1");
    expect(props.onMarkRead).not.toHaveBeenCalled();
  });

  it("shows no channel chip when the channel is not known", () => {
    inbox({ channelName: () => null });

    expect(screen.queryByRole("button", { name: /Otwórz #/ })).toBeNull();
  });

  it("words a mention in the reader's language from the author's name", () => {
    inbox({
      items: [{
        ...CHANNEL_ROW,
        title: "ignored",
        source: {
          ...CHANNEL_ROW.source,
          type: "system",
          packageId: "stellarr.mention",
          moduleName: "Ola",
        },
      }],
    });

    expect(screen.getByText("Ola oznacza Cię w wiadomości")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("names the package and its module when they differ", () => {
    inbox({
      items: [{ ...CHANNEL_ROW, source: { ...CHANNEL_ROW.source, moduleName: "Alerts" } }],
    });

    expect(screen.getByText("Deploys · Alerts")).toBeInTheDocument();
  });

  it("leaves an invitation without a join button when joining is not offered", () => {
    inbox({ items: [INVITE_ROW] });

    expect(screen.getByText("Zaproszenie na Nebula")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dołącz do serwera" })).toBeNull();
  });
});

describe("accepting an invitation", () => {
  it("disables joining while the request is out and re-enables it after", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onJoinInvite = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    inbox({ items: [INVITE_ROW], onJoinInvite });

    await user.click(screen.getByRole("button", { name: "Dołącz do serwera" }));

    expect(screen.getByRole("button", { name: "Dołączanie…" })).toBeDisabled();
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dołącz do serwera" })).toBeEnabled(),
    );
  });

  it("reports a refused invitation without offering a reload", async () => {
    const user = userEvent.setup();
    const onJoinInvite = vi.fn(() => Promise.reject(new Error("expired")));
    inbox({ items: [INVITE_ROW], onJoinInvite });

    await user.click(screen.getByRole("button", { name: "Dołącz do serwera" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Zaproszenie wygasło albo nie udało się go przyjąć.",
    );
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).toBeNull();
  });

  it("clears an earlier refusal when the invitation is tried again", async () => {
    const user = userEvent.setup();
    const onJoinInvite = vi
      .fn<(code: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce(undefined);
    inbox({ items: [INVITE_ROW], onJoinInvite });

    await user.click(screen.getByRole("button", { name: "Dołącz do serwera" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Dołącz do serwera" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(onJoinInvite).toHaveBeenCalledTimes(2);
  });
});

describe("paging", () => {
  it("disables the older-rows button while a page is loading", () => {
    inbox({ hasOlder: true, loadingMore: true });

    expect(screen.getByRole("button", { name: "Wczytywanie starszych…" })).toBeDisabled();
  });

  it("holds the older-rows button back while the first page loads", () => {
    inbox({ items: [], loading: true, hasOlder: true });

    expect(screen.queryByRole("button", { name: "Pokaż starsze" })).toBeNull();
  });
});
