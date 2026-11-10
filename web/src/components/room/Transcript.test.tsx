import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageGroupVM } from "./MessageGroup";
import { Transcript, type TranscriptSectionVM } from "./Transcript";

interface CapturedVirtuosoProps {
  "aria-busy"?: boolean;
  className?: string;
  data: Array<{ id: string }>;
  firstItemIndex: number;
  followOutput?: false | "auto" | "smooth";
  initialTopMostItemIndex:
    | number
    | { index: number | "LAST"; align?: "start" | "center" | "end" };
  rangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
  startReached?: (index: number) => void;
  atBottomStateChange?: (atBottom: boolean) => void;
  totalListHeightChanged?: (height: number) => void;
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  itemContent?: (index: number, row: unknown) => ReactElement;
}

const captured = vi.hoisted(() => ({
  props: null as CapturedVirtuosoProps | null,
  // The handle the transcript scrolls through; the mock is the only thing that
  // can stand in for a scroller with no layout behind it.
  scrollToIndex: null as ReturnType<typeof vi.fn> | null,
}));

function virtuosoProps(): CapturedVirtuosoProps {
  if (captured.props === null) {
    throw new Error("Virtuoso has not rendered yet");
  }
  return captured.props;
}

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  const { vi: vitest } = await import("vitest");
  return {
    Virtuoso: React.forwardRef<unknown, CapturedVirtuosoProps>(
      function VirtuosoMock(props, ref) {
        captured.props = props;
        captured.scrollToIndex ??= vitest.fn();
        React.useImperativeHandle(ref, () => ({
          scrollToIndex: captured.scrollToIndex,
        }));
        return React.createElement("div", { "data-testid": "virtuoso" });
      },
    ),
  };
});

function group(id: string, ...bodyIds: string[]): MessageGroupVM {
  return {
    id,
    authorId: "user-1",
    authorName: "Maja",
    timestamp: "2026-08-14T10:00:00Z",
    bodies: bodyIds.map((bodyId) => ({ id: bodyId, parts: [] })),
  };
}

function section(...ids: string[]): TranscriptSectionVM[] {
  return [{ day: "Dzisiaj", groups: ids.map((id) => group(id)) }];
}

describe("Transcript history window", () => {
  afterEach(() => vi.useRealTimers());

  it("mounts the virtual list only after the first page is ready, at its bottom", () => {
    captured.props = null;
    const { rerender } = render(
      <Transcript
        loading
        sections={section("message-1", "message-2")}
        label="Wiadomości"
      />,
    );

    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");
    expect(captured.props).toBeNull();

    rerender(
      <Transcript
        loading={false}
        sections={section("message-1", "message-2")}
        label="Wiadomości"
      />,
    );

    expect(screen.getByTestId("virtuoso")).toBeInTheDocument();
    expect(virtuosoProps().initialTopMostItemIndex).toEqual({
      index: "LAST",
      align: "end",
    });
  });

  it("hides repeated reply references inside a thread without changing its data", () => {
    const answer = group("answer-1", "answer-1");
    answer.replyTo = {
      id: "root-1",
      authorId: "user-2",
      authorName: "Nils",
      preview: "Wiadomość rozpoczynająca wątek",
    };
    render(
      <Transcript
        sections={[{ day: "Dzisiaj", groups: [answer] }]}
        label="Wątek"
        hideReplyReferences
      />,
    );

    const answerRow = virtuosoProps().data.find((row) => row.id === "answer-1");
    const rendered = virtuosoProps().itemContent?.(0, answerRow);

    expect(rendered?.props).toMatchObject({ replyTo: undefined });
    expect(answer.replyTo?.id).toBe("root-1");
  });

  it("keeps the visible message anchored when history and a live tail arrive together", () => {
    const onLoadOlder = vi.fn();
    const { rerender } = render(
      <Transcript
        sections={section("message-b", "message-c")}
        label="Wiadomości"
        hasOlder
        onLoadOlder={onLoadOlder}
      />,
    );

    // The day separator has absolute index 1_000_000; message B is the first
    // readable row and is where the user stopped before requesting history.
    act(() => {
      virtuosoProps().rangeChanged?.({
        startIndex: 1_000_001,
        endIndex: 1_000_002,
      });
      virtuosoProps().startReached?.(1_000_000);
    });
    expect(onLoadOlder).toHaveBeenCalledOnce();

    // A was prepended while D arrived over realtime. Looking only at the last
    // row would miss the prepend because the tail changed identity.
    rerender(
      <Transcript
        sections={section(
          "message-a",
          "message-b",
          "message-c",
          "message-d",
        )}
        label="Wiadomości"
        hasOlder
        loadingOlder
        onLoadOlder={onLoadOlder}
      />,
    );

    expect(virtuosoProps().firstItemIndex).toBe(999_999);
  });

  it("keeps the opening at the bottom until measurements settle", () => {
    vi.useFakeTimers();
    captured.scrollToIndex?.mockClear();
    render(<Transcript sections={section("message-1")} label="Wiadomości" />);

    const scroller = document.createElement("div");
    let scrollHeight = 723;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, value: 100, writable: true },
    });

    act(() => virtuosoProps().scrollerRef?.(scroller));
    // Our code must not compete with Virtuoso before its delayed initial scroll.
    expect(scroller.scrollTop).toBe(100);
    expect(virtuosoProps().className).toBe("transcript opening");
    expect(virtuosoProps()["aria-busy"]).toBe(true);

    act(() => virtuosoProps().atBottomStateChange?.(true));
    expect(scroller.scrollTop).toBe(123);

    // The first size was provisional. A later measurement closes the new gap
    // and restarts the quiet window before the transcript becomes visible.
    scrollHeight = 740;
    act(() => {
      virtuosoProps().totalListHeightChanged?.(740);
    });
    expect(scroller.scrollTop).toBe(140);
    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(virtuosoProps().className).toBe("transcript opening");
    act(() => vi.advanceTimersByTime(1));
    expect(virtuosoProps().className).toBe("transcript");
    expect(virtuosoProps()["aria-busy"]).toBe(false);

    // Late content follows an exact bottom, but a reader who has moved even
    // within Virtuoso's broad threshold is not pulled back down.
    scrollHeight = 760;
    act(() => virtuosoProps().totalListHeightChanged?.(760));
    expect(scroller.scrollTop).toBe(160);
    scroller.scrollTop = 100;
    scrollHeight = 1_000;
    act(() => virtuosoProps().totalListHeightChanged?.(1_000));
    expect(scroller.scrollTop).toBe(100);
  });

  it("anchors one real arrival before paint and ignores its server reconciliation", () => {
    captured.scrollToIndex?.mockClear();
    const { rerender } = render(
      <Transcript
        sections={[{ day: "Dzisiaj", groups: [group("group-1", "message-1")] }]}
        label="Wiadomości"
      />,
    );
    const scroller = document.createElement("div");
    let scrollHeight = 600;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    act(() => virtuosoProps().scrollerRef?.(scroller));

    scrollHeight = 624;
    rerender(
      <Transcript
        sections={[
          {
            day: "Dzisiaj",
            groups: [group("group-1", "message-1", "local-2")],
          },
        ]}
        label="Wiadomości"
      />,
    );

    expect(virtuosoProps().followOutput).toBe(false);
    expect(scroller.scrollTop).toBe(24);
    expect(captured.scrollToIndex).not.toHaveBeenCalled();

    scrollHeight = 640;
    rerender(
      <Transcript
        sections={[
          {
            day: "Dzisiaj",
            groups: [group("group-1", "message-1", "server-2")],
          },
        ]}
        label="Wiadomości"
      />,
    );
    // Reconciliation changed the id but not the message count, so the later
    // height change is not mistaken for another arrival.
    expect(scroller.scrollTop).toBe(24);
    expect(captured.scrollToIndex).not.toHaveBeenCalled();
  });
});

describe("Transcript own send", () => {
  afterEach(() => vi.useRealTimers());

  /** A settled transcript with the reader parked well above the newest row. */
  function readerScrolledUp() {
    vi.useFakeTimers();
    captured.scrollToIndex?.mockClear();
    const view = render(
      <Transcript
        sections={[{ day: "Dzisiaj", groups: [group("group-1", "message-1")] }]}
        label="Wiadomości"
        followOwnSend={0}
      />,
    );
    const scroller = document.createElement("div");
    const height = { value: 1_000 };
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, get: () => height.value },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    act(() => virtuosoProps().scrollerRef?.(scroller));
    act(() => virtuosoProps().atBottomStateChange?.(true));
    act(() => vi.advanceTimersByTime(180));

    // Away from the end, which is what makes the two cases below differ.
    act(() => virtuosoProps().atBottomStateChange?.(false));
    scroller.scrollTop = 120;
    return { ...view, scroller, height };
  }

  it("goes to your own message even when you were reading further up", () => {
    const { rerender, scroller, height } = readerScrolledUp();

    height.value = 1_080;
    rerender(
      <Transcript
        sections={[
          { day: "Dzisiaj", groups: [group("group-1", "message-1", "local-2")] },
        ]}
        label="Wiadomości"
        followOwnSend={1}
      />,
    );

    // 1080 - 600: the send is an action, so it commands the view.
    expect(scroller.scrollTop).toBe(480);
  });

  it("leaves a reader alone when the arrival is somebody else's", () => {
    const { rerender, scroller, height } = readerScrolledUp();

    height.value = 1_080;
    rerender(
      <Transcript
        sections={[
          { day: "Dzisiaj", groups: [group("group-1", "message-1", "other-2")] },
        ]}
        label="Wiadomości"
        followOwnSend={0}
      />,
    );

    // Being yanked mid-read is worse than missing a line, so nothing moves.
    expect(scroller.scrollTop).toBe(120);
  });
});

describe("Transcript catch-up button", () => {
  beforeEach(() => captured.scrollToIndex?.mockClear());

  function arrive(rerender: (ui: ReactElement) => void, ...ids: string[]) {
    rerender(<Transcript sections={section(...ids)} label="Wiadomości" />);
  }

  it("stays away while the reader is on the newest message", () => {
    const { rerender } = render(
      <Transcript sections={section("message-1")} label="Wiadomości" />,
    );

    arrive(rerender, "message-1", "message-2");

    // The list follows the end for a reader who is on it; nothing to go back to.
    expect(screen.queryByRole("button", { name: /wiadomości/i })).toBeNull();
  });

  it("appears as soon as the end is off screen, before anything arrives", async () => {
    const user = userEvent.setup();
    render(<Transcript sections={section("message-1", "message-2")} label="Wiadomości" />);

    act(() => virtuosoProps().atBottomStateChange?.(false));

    // Nothing has happened down there yet, so it is an arrow and nothing else.
    const jump = screen.getByRole("button", {
      name: "Przejdź do najnowszych wiadomości",
    });
    expect(jump).toHaveTextContent("");

    await user.click(jump);
    // The end of the list, by its index: day separator, then two blocks.
    expect(captured.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2, align: "end" }),
    );
  });

  it("names itself once a message lands while the reader is away", () => {
    const { rerender } = render(
      <Transcript sections={section("message-1")} label="Wiadomości" />,
    );

    act(() => virtuosoProps().atBottomStateChange?.(false));
    expect(screen.queryByRole("button", { name: /Nowe wiadomości/ })).toBeNull();

    arrive(rerender, "message-1", "message-2");
    expect(screen.getByRole("button", { name: /Nowe wiadomości/ })).toBeVisible();
  });

  it("leaves of its own accord when the reader scrolls back down", () => {
    const { rerender } = render(
      <Transcript sections={section("message-1")} label="Wiadomości" />,
    );

    act(() => virtuosoProps().atBottomStateChange?.(false));
    arrive(rerender, "message-1", "message-2");
    expect(screen.getByRole("button", { name: /Nowe wiadomości/ })).toBeVisible();

    act(() => virtuosoProps().atBottomStateChange?.(true));
    expect(screen.queryByRole("button", { name: /wiadomości/i })).toBeNull();
  });
});
