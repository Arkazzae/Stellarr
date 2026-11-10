import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { playSystemFx } from "@/lib/audio/systemFx";
import {
  createChatHarness,
  deferred,
  journal,
  page,
} from "@/test/chatHarness";
import { at, message } from "@/test/messages";

import { ChatProvider, useChatContext, type ChatValue } from "./ChatProvider";

const world = vi.hoisted(() => ({
  h: undefined as unknown as ReturnType<typeof createChatHarness>,
}));

vi.mock("./PortsProvider", () => ({ usePorts: () => world.h.ports }));
vi.mock("./AccountProvider", () => ({ useAccountContext: () => world.h.account }));
vi.mock("./SessionProvider", () => ({ useSessionContext: () => world.h.session }));
vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => world.h.directory,
}));
vi.mock("./EmojiProvider", () => ({ useEmoji: () => world.h.emoji }));
vi.mock("./LanguageProvider", () => ({ useLanguage: () => world.h.language }));
vi.mock("./UiProvider", () => ({ useUiContext: () => world.h.ui }));
vi.mock("@/lib/audio/systemFx", () => ({ playSystemFx: vi.fn() }));

let h: typeof world.h;

beforeEach(() => {
  h = createChatHarness();
  world.h = h;
  vi.mocked(playSystemFx).mockClear();
});

function Wrapper({ children }: { children: ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

function mount() {
  return renderHook(() => useChatContext(), { wrapper: Wrapper });
}

/** Mounts and waits for the open channel's first page. */
async function mountLoaded() {
  const mounted = mount();
  await waitFor(() => expect(mounted.result.current.loading).toBe(false));
  return mounted;
}

const bodies = (chat: ChatValue) =>
  chat.sections.flatMap((section) => section.groups.flatMap((group) => group.bodies));
const ids = (chat: ChatValue) => bodies(chat).map((body) => body.id);
const textOf = (chat: ChatValue, id: string) =>
  JSON.stringify(bodies(chat).find((body) => body.id === id)?.parts);

const ADA = { id: "u-ada", displayName: "Ada" };

function twoChannels() {
  h.directory.textChannels = [
    { id: "ch-general", name: "general" },
    { id: "ch-random", name: "random" },
  ];
}

describe("history", () => {
  it("reads the first page of the open channel once", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    const { result, rerender } = mount();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result.current)).toEqual(["m1", "m2"]);

    rerender();
    expect(h.chat.listMessages).toHaveBeenCalledTimes(1);
    expect(h.chat.listMessages).toHaveBeenCalledWith("ch-general", { limit: 50 });
  });

  it("reads a channel the first time it is opened and never again", async () => {
    twoChannels();
    const { result, rerender } = await mountLoaded();

    h.ui.activeTextChannelId = "ch-random";
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    h.ui.activeTextChannelId = "ch-general";
    rerender();

    expect(h.chat.listMessages.mock.calls.map(([channel]) => channel)).toEqual([
      "ch-general",
      "ch-random",
    ]);
    expect(h.chat.listPinned).toHaveBeenCalledTimes(2);
  });

  it("reads every text channel's threads once, not only the open one", async () => {
    twoChannels();
    await mountLoaded();
    await waitFor(() => expect(h.chat.listThreads).toHaveBeenCalledTimes(2));
    expect(h.chat.listThreads.mock.calls.map(([channel]) => channel).sort()).toEqual([
      "ch-general",
      "ch-random",
    ]);
  });

  it("ends loading with nothing older when the first page cannot be read", async () => {
    h.chat.listMessages.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.sections).toEqual([]);
  });

  it("does not ask for an older page twice at once", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m3", 3)], "older"));
    const older = deferred<ReturnType<typeof page>>();
    h.chat.listMessages.mockReturnValueOnce(older.promise);
    const { result } = await mountLoaded();
    expect(result.current.hasOlder).toBe(true);

    act(() => {
      result.current.loadOlder();
      result.current.loadOlder();
    });
    expect(h.chat.listMessages).toHaveBeenCalledTimes(2);
    expect(h.chat.listMessages).toHaveBeenLastCalledWith("ch-general", {
      cursor: "older",
      limit: 50,
    });
    expect(result.current.loadingOlder).toBe(true);

    await act(async () => older.resolve(page([message("m1", 1), message("m2", 2)])));
    expect(ids(result.current)).toEqual(["m1", "m2", "m3"]);
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.loadingOlder).toBe(false);
  });

  it("keeps the cursor when an older page fails, so the next trip to the top retries", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m3", 3)], "older"));
    h.chat.listMessages.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));
    expect(result.current.hasOlder).toBe(true);

    h.chat.listMessages.mockResolvedValueOnce(page([message("m2", 2)]));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(ids(result.current)).toEqual(["m2", "m3"]));
  });
});

describe("what the server pushes", () => {
  it("shows a pushed message once, however many times it arrives", async () => {
    const { result } = await mountLoaded();
    act(() => {
      h.emit.message(message("m1", 1, { author: ADA }));
      h.emit.message(message("m1", 1, { author: ADA }));
    });
    expect(ids(result.current)).toEqual(["m1"]);
  });

  it("counts unread messages on the channels you are not reading", async () => {
    twoChannels();
    const { result } = await mountLoaded();
    const now = new Date().toISOString();

    act(() => {
      h.emit.message(message("elsewhere", 1, { channelId: "ch-random", author: ADA, createdAt: now }));
      h.emit.message(message("here", 1, { author: ADA, createdAt: now }));
      h.emit.message(
        message("mine", 1, {
          channelId: "ch-random",
          author: { id: "u-maja", displayName: "Maja" },
          createdAt: now,
        }),
      );
    });
    expect(result.current.unreadByChannel).toEqual({ "ch-random": 1 });
  });

  it("chimes for someone else's message in another channel, and only then", async () => {
    twoChannels();
    await mountLoaded();

    act(() => {
      h.emit.message(message("open", 1, { author: ADA }));
      h.emit.message(
        message("own", 2, {
          channelId: "ch-random",
          author: { id: "u-maja", displayName: "Maja" },
        }),
      );
    });
    expect(playSystemFx).not.toHaveBeenCalled();

    act(() => h.emit.message(message("other", 3, { channelId: "ch-random", author: ADA })));
    expect(playSystemFx).toHaveBeenCalledWith("notification");
  });

  it("applies an edit to a loaded message", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    expect(textOf(result.current, "m1")).toContain("content of m1");

    act(() => h.emit.updated(message("m1", 1, { content: "rewritten", editedAt: at(5) })));
    expect(textOf(result.current, "m1")).toContain("rewritten");
    expect(ids(result.current)).toEqual(["m1"]);
  });

  it("does not add an edited message that was never loaded", async () => {
    const { result } = await mountLoaded();
    act(() => h.emit.updated(message("stranger", 1)));
    expect(ids(result.current)).toEqual([]);
  });

  it("merges unfurled cards into their message", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    const kinds = () => bodies(result.current)[0]?.parts.map((part) => part.kind);
    expect(kinds()).toEqual(["text"]);

    act(() =>
      h.emit.embeds({
        channelId: "ch-general",
        messageId: "m1",
        embeds: [
          {
            id: "e1",
            url: "https://example.com/card",
            kind: "link",
            provider: "example.com",
            domain: "example.com",
            title: "A card",
          },
        ],
      }),
    );
    expect(kinds()).toEqual(["text", "embed"]);
  });

  it("removes a deleted message and stops answering it or showing its thread", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    const { result } = await mountLoaded();

    act(() => result.current.runAction("m1", "reply"));
    expect(result.current.replyingTo?.id).toBe("m1");
    act(() => h.emit.deleted("ch-general", "m1"));
    expect(ids(result.current)).toEqual(["m2"]);
    expect(result.current.replyingTo).toBeNull();

    act(() => result.current.runAction("m2", "thread"));
    expect(result.current.thread?.rootId).toBe("m2");
    act(() => h.emit.deleted("ch-general", "m2"));
    expect(result.current.thread).toBeNull();
  });

  it("shows who is typing in the open channel", async () => {
    twoChannels();
    const { result } = await mountLoaded();
    act(() => {
      h.emit.typing("ch-general", ["Ada"]);
      h.emit.typing("ch-random", ["Bob"]);
    });
    expect(result.current.typingNames).toEqual(["Ada"]);
  });

  it("rebuilds the transcript with a message's reactions and toggles them", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();

    act(() => result.current.react("m1", "👍"));
    expect(h.messageActions.react).toHaveBeenCalledWith("m1", "👍");

    act(() => h.emit.reactions("m1", [{ emoji: "👍", count: 1, mine: true }]));
    expect(bodies(result.current)[0]?.reactions).toEqual([
      { emoji: "👍", count: 1, mine: true },
    ]);
    act(() => result.current.react("m1", "👍"));
    expect(h.messageActions.unreact).toHaveBeenCalledWith("m1", "👍");
  });
});

describe("pins", () => {
  const pinned = (id: string, minute: number) =>
    message(id, 1, { pinnedAt: at(minute) });

  it("lists the channel's pins newest first from their own read", async () => {
    h.chat.listPinned.mockResolvedValueOnce([pinned("p1", 2), pinned("p2", 3)]);
    const { result } = mount();
    expect(result.current.pinnedLoading).toBe(true);

    await waitFor(() => expect(result.current.pinnedLoading).toBe(false));
    expect(result.current.pinned.map((pin) => pin.id)).toEqual(["p2", "p1"]);
  });

  it("moves the list when a pin or unpin is echoed back", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    await waitFor(() => expect(result.current.pinnedLoading).toBe(false));

    act(() => h.emit.updated(pinned("m1", 5)));
    expect(result.current.pinned.map((pin) => pin.id)).toEqual(["m1"]);
    expect(bodies(result.current)[0]?.pinned).toBe(true);

    act(() => h.emit.updated(message("m1", 1)));
    expect(result.current.pinned).toEqual([]);
    expect(bodies(result.current)[0]?.pinned).toBeUndefined();
  });

  it("asks to pin an unpinned message and to unpin a pinned one", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1), pinned("m2", 4)]));
    h.chat.listPinned.mockResolvedValueOnce([pinned("m2", 4)]);
    const { result } = await mountLoaded();
    await waitFor(() => expect(result.current.pinnedLoading).toBe(false));

    act(() => result.current.runAction("m1", "pin"));
    act(() => result.current.runAction("m2", "pin"));
    expect(h.messageActions.setPinned.mock.calls).toEqual([
      ["m1", true],
      ["m2", false],
    ]);
  });

  it("says why a pin was refused and opens the pinned list", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    h.messageActions.setPinned.mockRejectedValueOnce(new Error("refused"));
    const { result } = await mountLoaded();

    act(() => result.current.runAction("m1", "pin"));
    await waitFor(() => expect(result.current.pinError).toBe("message.pinFailed"));
    expect(h.ui.showChannelPanelTab).toHaveBeenCalledWith("pinned");
  });
});

describe("after a reconnect", () => {
  it("replays the journal from the stored cursor, and resumes from where it stopped", async () => {
    h.chat.listMessages.mockResolvedValueOnce(
      page([message("m1", 1)], null, "c1"),
    );
    h.chat.syncMessages.mockResolvedValueOnce(
      journal(
        [
          { cursor: "c2", kind: "upsert", messageId: "m2", message: message("m2", 2) },
          { cursor: "c2", kind: "delete", messageId: "m1" },
        ],
        "c2",
      ),
    );
    const { result } = await mountLoaded();

    act(() => h.setConnection("connected"));
    await waitFor(() => expect(ids(result.current)).toEqual(["m2"]));
    expect(h.chat.focusChannel).toHaveBeenCalledWith("ch-general");
    expect(h.chat.syncMessages).toHaveBeenCalledWith("ch-general", "c1");

    act(() => h.setConnection("reconnecting"));
    act(() => h.setConnection("connected"));
    await waitFor(() => expect(h.chat.syncMessages).toHaveBeenCalledTimes(2));
    expect(h.chat.syncMessages).toHaveBeenLastCalledWith("ch-general", "c2");
  });

  it("keeps draining while the server says there is more", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([], null, "c1"));
    h.chat.syncMessages
      .mockResolvedValueOnce(
        journal(
          [{ cursor: "c2", kind: "upsert", messageId: "a", message: message("a", 1) }],
          "c2",
          { hasMore: true },
        ),
      )
      .mockResolvedValueOnce(
        journal(
          [{ cursor: "c3", kind: "upsert", messageId: "b", message: message("b", 2) }],
          "c3",
        ),
      );
    const { result } = await mountLoaded();

    act(() => h.setConnection("connected"));
    await waitFor(() => expect(ids(result.current)).toEqual(["a", "b"]));
    expect(h.chat.syncMessages.mock.calls.map(([, after]) => after)).toEqual(["c1", "c2"]);
  });

  it("reloads the newest window when the server says the journal was compacted", async () => {
    h.chat.listMessages
      .mockResolvedValueOnce(page([message("old", 1)], null, "c1"))
      .mockResolvedValueOnce(page([message("fresh", 9)], "older", "c9"));
    h.chat.syncMessages.mockResolvedValueOnce(journal([], "c1", { resetRequired: true }));
    const { result } = await mountLoaded();

    act(() => h.setConnection("connected"));
    await waitFor(() => expect(ids(result.current)).toEqual(["fresh"]));
    expect(result.current.hasOlder).toBe(true);
    await waitFor(() => expect(h.chat.syncMessages).toHaveBeenCalledTimes(2));
    expect(h.chat.syncMessages).toHaveBeenLastCalledWith("ch-general", "c9");
  });

  it("reads the first page itself when the socket is up before any page was read", async () => {
    h.setConnection("connected");
    h.chat.listMessages.mockResolvedValue(page([message("m1", 1)], null, "c1"));
    const { result } = mount();

    await waitFor(() => expect(h.chat.syncMessages).toHaveBeenCalledWith("ch-general", "c1"));
    expect(ids(result.current)).toEqual(["m1"]);
  });

  it("retries from the same cursor on the next reconnect after a failure", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([], null, "c1"));
    h.chat.syncMessages.mockRejectedValueOnce(new Error("dropped"));
    await mountLoaded();

    act(() => h.setConnection("connected"));
    await waitFor(() => expect(h.chat.syncMessages).toHaveBeenCalledTimes(1));
    act(() => h.setConnection("reconnecting"));
    act(() => h.setConnection("connected"));
    await waitFor(() => expect(h.chat.syncMessages).toHaveBeenCalledTimes(2));
    expect(h.chat.syncMessages.mock.calls.map(([, after]) => after)).toEqual(["c1", "c1"]);
  });

  it("reads the pinned list again before replaying, so a journal pin is not overwritten", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([], null, "c1"));
    const pin = message("m1", 1, { pinnedAt: at(3) });
    h.chat.listPinned.mockResolvedValueOnce([]).mockResolvedValueOnce([pin]);
    const { result } = await mountLoaded();
    await waitFor(() => expect(result.current.pinnedLoading).toBe(false));

    act(() => h.setConnection("connected"));
    await waitFor(() =>
      expect(result.current.pinned.map((row) => row.id)).toEqual(["m1"]),
    );
  });
});
