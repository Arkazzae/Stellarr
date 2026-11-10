import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelPanelProps } from "@/components/room/ChannelPanel";
import type { Message } from "@/ports";
import type { ChatValue, DirectoryValue, UiValue } from "@/state/hooks";
import { fakeChat, fakeDirectory, fakeLanguage, fakeUi, t } from "@/test/roomFakes";
import { message } from "@/test/messages";

import { ChannelPanelContainer } from "./ChannelPanelContainer";

const mocks = vi.hoisted(() => ({
  chat: null as unknown as ChatValue,
  ui: null as unknown as UiValue,
  directory: null as unknown as DirectoryValue,
  language: null as unknown,
  ports: { chat: { listIndexed: vi.fn() } },
  panel: null as ChannelPanelProps | null,
}));

vi.mock("@/state/hooks", () => ({
  useChat: () => mocks.chat,
  useUi: () => mocks.ui,
  useDirectory: () => mocks.directory,
  useLanguage: () => mocks.language,
  usePorts: () => mocks.ports,
}));

vi.mock("@/components/room/ChannelPanel", () => ({
  ChannelPanel: (props: ChannelPanelProps) => {
    mocks.panel = props;
    return null;
  },
}));

const listIndexed = mocks.ports.chat.listIndexed;

function picture(id: string, minute: number): Message {
  return message(id, minute, {
    attachments: [
      { id: `a-${id}`, url: `/files/${id}.png`, name: `${id}.png`, contentType: "image/png", size: 4 },
    ],
  });
}

const panel = () => mocks.panel!;
/** The message each media item came from; its id adds the item's place in it. */
const sources = (items: ChannelPanelProps["media"]) =>
  items.map((item) => item.id.split(":")[0]);
const onJump = vi.fn();

function mount() {
  return render(<ChannelPanelContainer open callbacks={{}} onJump={onJump} />);
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function typeQuery(query: string) {
  act(() => panel().onSearchQueryChange(query));
  await settle(250);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.chat = fakeChat();
  mocks.ui = fakeUi({ channelPanel: "search", channelPanelTab: "search" });
  mocks.directory = fakeDirectory();
  mocks.language = fakeLanguage();
  mocks.panel = null;
  listIndexed.mockResolvedValue({ messages: [], nextCursor: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChannelPanelContainer search", () => {
  it("asks the index only once the query is two characters long, after a pause", async () => {
    mount();

    await typeQuery("a");
    expect(listIndexed).not.toHaveBeenCalled();
    expect(panel().searchLoading).toBe(false);

    act(() => panel().onSearchQueryChange("pl"));
    await settle(249);
    expect(listIndexed).not.toHaveBeenCalled();
    expect(panel().searchLoading).toBe(true);

    await settle(1);
    expect(listIndexed).toHaveBeenCalledExactlyOnceWith("ch-general", {
      kind: "all",
      query: "pl",
      limit: 50,
    });
  });

  it("searches for the trimmed query", async () => {
    mount();

    await typeQuery("  plan ");

    expect(listIndexed).toHaveBeenCalledWith("ch-general", {
      kind: "all",
      query: "plan",
      limit: 50,
    });
  });

  it("lists the results, loads the next page from the cursor and skips repeats", async () => {
    listIndexed
      .mockResolvedValueOnce({ messages: [message("m1", 1), message("m2", 2)], nextCursor: "c1" })
      .mockResolvedValueOnce({ messages: [message("m2", 2), message("m3", 3)], nextCursor: null });
    mount();

    await typeQuery("plan");

    expect(panel().searchResults.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(panel().searchHasMore).toBe(true);
    expect(panel().searchLoading).toBe(false);

    act(() => panel().onLoadMoreSearch?.());
    await settle();

    expect(listIndexed).toHaveBeenLastCalledWith("ch-general", {
      kind: "all",
      query: "plan",
      cursor: "c1",
      limit: 50,
    });
    expect(panel().searchResults.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(panel().searchHasMore).toBe(false);
  });

  it("hides the old results the moment the query changes", async () => {
    listIndexed.mockResolvedValueOnce({ messages: [message("m1", 1)], nextCursor: null });
    mount();
    await typeQuery("plan");
    expect(panel().searchResults).toHaveLength(1);

    act(() => panel().onSearchQueryChange("plans"));

    expect(panel().searchResults).toEqual([]);
    expect(panel().searchLoading).toBe(true);
  });

  it("says why a search failed and asks again on retry", async () => {
    listIndexed.mockRejectedValueOnce(new Error("offline"));
    mount();

    await typeQuery("plan");

    expect(panel().searchError).toBe(t("room.indexLoadFailed"));
    expect(panel().searchLoading).toBe(false);

    listIndexed.mockResolvedValueOnce({ messages: [message("m1", 1)], nextCursor: null });
    act(() => panel().onRetrySearch?.());
    await settle(250);

    expect(listIndexed).toHaveBeenCalledTimes(2);
    expect(panel().searchError).toBeNull();
    expect(panel().searchResults).toHaveLength(1);
  });

  it("opens a result by revealing it, closing drawers and scrolling to it", async () => {
    const result = message("m9", 9);
    mount();

    act(() => panel().onOpenSearchResult?.(result));

    expect(mocks.chat.revealMessage).toHaveBeenCalledExactlyOnceWith(result);
    expect(mocks.ui.closeDrawers).toHaveBeenCalledOnce();
    expect(onJump).not.toHaveBeenCalled();
    await settle(50);
    expect(onJump).toHaveBeenCalledExactlyOnceWith("m9");
  });
});

describe("ChannelPanelContainer media and links", () => {
  beforeEach(() => {
    mocks.ui = fakeUi({ channelPanel: "media", channelPanelTab: "media" });
  });

  it("reads the media index straight away, newest first", async () => {
    listIndexed.mockResolvedValueOnce({
      messages: [picture("old", 1), picture("new", 5)],
      nextCursor: "c1",
    });
    mount();

    expect(panel().indexLoading).toBe(true);
    await settle();

    expect(listIndexed).toHaveBeenCalledExactlyOnceWith("ch-general", { kind: "media", limit: 60 });
    expect(sources(panel().media)).toEqual(["new", "old"]);
    expect(panel().indexLoading).toBe(false);
    expect(panel().indexHasMore).toBe(true);
  });

  it("appends the next page of the index", async () => {
    listIndexed
      .mockResolvedValueOnce({ messages: [picture("a", 1)], nextCursor: "c1" })
      .mockResolvedValueOnce({ messages: [picture("b", 2)], nextCursor: null });
    mount();
    await settle();

    act(() => panel().onLoadMoreIndex?.());
    await settle();

    expect(listIndexed).toHaveBeenLastCalledWith("ch-general", {
      kind: "media",
      cursor: "c1",
      limit: 60,
    });
    expect(sources(panel().media)).toEqual(["b", "a"]);
    expect(panel().indexHasMore).toBe(false);
  });

  it("reads nothing for the tabs that list the transcript's own material", async () => {
    mocks.ui = fakeUi({ channelPanel: "pinned", channelPanelTab: "pinned" });
    mount();

    await settle(500);

    expect(listIndexed).not.toHaveBeenCalled();
    expect(panel().indexLoading).toBe(false);
  });
});

describe("ChannelPanelContainer pins", () => {
  it("passes the pins through and jumps to one", () => {
    const pinned = [{ id: "m1" }] as unknown as ChatValue["pinned"];
    mocks.chat = fakeChat({ pinned, pinnedLoading: true, pinError: "boom" });
    mount();

    expect(panel()).toMatchObject({
      pinned,
      pinnedLoading: true,
      pinError: "boom",
      pinsSupported: true,
    });
    panel().onOpenPin?.("m1");
    expect(onJump).toHaveBeenCalledExactlyOnceWith("m1");
  });

  it("offers unpinning only to someone who can moderate", () => {
    mount();
    expect(panel().onUnpin).toBeUndefined();

    mocks.directory = fakeDirectory({ canManageMessages: true });
    mount();
    panel().onUnpin?.("m1");

    expect(mocks.chat.runAction).toHaveBeenCalledExactlyOnceWith("m1", "pin");
  });
});
