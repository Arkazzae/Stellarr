import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { Message } from "@/ports";
import { fakeLanguage, t } from "@/test/roomFakes";
import { message } from "@/test/messages";

import { useIndexedPages, type IndexedPagesRequest } from "./useIndexedPages";

const mocks = vi.hoisted(() => ({
  ports: { chat: { listIndexed: vi.fn() } },
}));

vi.mock("@/state/hooks", () => ({
  usePorts: () => mocks.ports,
  useLanguage: () => fakeLanguage(),
}));

const listIndexed = mocks.ports.chat.listIndexed;
const MEDIA: IndexedPagesRequest = { kind: "media", limit: 10, delayMs: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function pages(initial: { channelId: string | null; request: IndexedPagesRequest | null }) {
  return renderHook(
    (props: typeof initial) => useIndexedPages(props.channelId, props.request),
    { initialProps: initial },
  );
}

const ids = (messages: readonly Message[]) => messages.map((m) => m.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listIndexed.mockResolvedValue({ messages: [], nextCursor: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useIndexedPages", () => {
  it("reads nothing without a request or without a channel", async () => {
    const idle = pages({ channelId: "ch-1", request: null });
    const homeless = pages({ channelId: null, request: MEDIA });
    await settle(1000);

    expect(listIndexed).not.toHaveBeenCalled();
    expect(idle.result.current.loading).toBe(false);
    expect(homeless.result.current.loading).toBe(true);
  });

  it("shows nothing from a channel once another is open", async () => {
    listIndexed.mockResolvedValueOnce({ messages: [message("m1", 1)], nextCursor: null });
    const { result, rerender } = pages({ channelId: "ch-1", request: MEDIA });
    await settle();
    expect(ids(result.current.messages)).toEqual(["m1"]);

    rerender({ channelId: "ch-2", request: MEDIA });

    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(true);
    await settle();
    expect(listIndexed).toHaveBeenLastCalledWith("ch-2", { kind: "media", limit: 10 });
  });

  it("drops a next page that arrives after the channel changed", async () => {
    listIndexed.mockResolvedValueOnce({ messages: [message("m1", 1)], nextCursor: "c1" });
    const late = deferred<{ messages: Message[]; nextCursor: string | null }>();
    const { result, rerender } = pages({ channelId: "ch-1", request: MEDIA });
    await settle();
    listIndexed.mockReturnValueOnce(late.promise);
    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);

    listIndexed.mockResolvedValueOnce({ messages: [message("n1", 1)], nextCursor: null });
    rerender({ channelId: "ch-2", request: MEDIA });
    await settle();
    await act(async () => late.resolve({ messages: [message("m2", 2)], nextCursor: null }));

    expect(ids(result.current.messages)).toEqual(["n1"]);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  it("does not start a second next-page request while one is in flight", async () => {
    listIndexed.mockResolvedValueOnce({ messages: [message("m1", 1)], nextCursor: "c1" });
    const { result } = pages({ channelId: "ch-1", request: MEDIA });
    await settle();
    listIndexed.mockReturnValue(new Promise(() => {}));

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());

    expect(listIndexed).toHaveBeenCalledTimes(2);
  });

  it("keeps what it has when a next page fails, and says why", async () => {
    listIndexed.mockResolvedValueOnce({ messages: [message("m1", 1)], nextCursor: "c1" });
    const { result } = pages({ channelId: "ch-1", request: MEDIA });
    await settle();
    listIndexed.mockRejectedValueOnce(new Error("offline"));

    act(() => result.current.loadMore());
    await settle();

    expect(ids(result.current.messages)).toEqual(["m1"]);
    expect(result.current.error).toBe(t("room.indexLoadFailed"));
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });

  it("explains an API failure in the catalogue's words", async () => {
    listIndexed.mockRejectedValueOnce(new ApiError("forbidden", "no", 403));
    const { result } = pages({ channelId: "ch-1", request: MEDIA });

    await settle();

    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toBe(t("room.indexLoadFailed"));
  });
});
