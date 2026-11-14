import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import { showMessageNotification } from "@/lib/notifications/browser";
import type { ChatPort, Message, UserPreferences } from "@/ports";

import { useMentionNotifications } from "./useMentionNotifications";

vi.mock("@/lib/notifications/browser", () => ({ showMessageNotification: vi.fn() }));

const t = (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values);

const preferences = {
  desktopNotifications: true,
  mutedChannelIds: [] as string[],
} as UserPreferences;

function message(content: string, channelId = "c-design"): Message {
  return {
    id: "m-1",
    channelId,
    author: { id: "u-nils", displayName: "Nils" },
    content,
    attachments: [],
    embeds: [],
    createdAt: "2026-11-14T12:00:00Z",
  };
}

function setup(overrides: Partial<Parameters<typeof useMentionNotifications>[0]> = {}) {
  let deliver: (message: Message) => void = () => undefined;
  const chat = {
    onMessage: vi.fn((handler: (message: Message) => void) => {
      deliver = handler;
      return () => undefined;
    }),
  } as unknown as ChatPort;
  const openChannel = vi.fn();
  const view = renderHook((props: Parameters<typeof useMentionNotifications>[0]) =>
    useMentionNotifications(props), {
    initialProps: {
      chat,
      selfId: "u-ada",
      selfUsername: "ada",
      preferences,
      channelName: (id: string) => (id === "c-design" ? "projekt" : null),
      openChannel,
      t,
      ...overrides,
    },
  });
  return { deliver: (m: Message) => deliver(m), openChannel, chat, view };
}

let focused = false;

beforeEach(() => {
  vi.mocked(showMessageNotification).mockClear();
  focused = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMentionNotifications", () => {
  it("pops up a mention while the window is away, named after its channel", () => {
    const { deliver, openChannel } = setup();

    deliver(message("@ada spójrz na to"));

    expect(showMessageNotification).toHaveBeenCalledOnce();
    const shown = vi.mocked(showMessageNotification).mock.calls[0]![0];
    expect(shown).toMatchObject({
      id: "m-1",
      title: "Nils oznacza Cię na #projekt",
      body: "@ada spójrz na to",
    });

    shown.onOpen?.();
    expect(openChannel).toHaveBeenCalledExactlyOnceWith("c-design");
  });

  it("falls back to the plain title for a channel it cannot name", () => {
    const { deliver } = setup();

    deliver(message("@ada hej", "c-elsewhere"));

    expect(vi.mocked(showMessageNotification).mock.calls[0]![0].title)
      .toBe("Nils oznacza Cię w wiadomości");
  });

  it("stays quiet while the window has focus", () => {
    focused = true;
    const { deliver } = setup();

    deliver(message("@ada spójrz"));

    expect(showMessageNotification).not.toHaveBeenCalled();
  });

  it("reads the newest preferences without subscribing again", () => {
    const { deliver, view, chat } = setup();

    view.rerender({
      chat,
      selfId: "u-ada",
      selfUsername: "ada",
      preferences: { ...preferences, mutedChannelIds: ["c-design"] },
      channelName: () => "projekt",
      openChannel: vi.fn(),
      t,
    });
    deliver(message("@ada spójrz"));

    expect(chat.onMessage).toHaveBeenCalledOnce();
    expect(showMessageNotification).not.toHaveBeenCalled();
  });
});
