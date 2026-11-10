import { act, render, screen } from "@testing-library/react";
import type { ComponentType, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageGroupProps, MessageGroupVM } from "./MessageGroup";
import { Transcript, type TranscriptSectionVM } from "./Transcript";

interface CapturedVirtuosoProps {
  className?: string;
  data: Array<{ id: string }>;
  startReached?: (index: number) => void;
  atBottomStateChange?: (atBottom: boolean) => void;
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  components?: { Header?: ComponentType };
  // Separator rows are not message groups; the tests that look at those only
  // render the element and never read its props.
  itemContent: (index: number, row: unknown) => ReactElement<MessageGroupProps>;
}

const captured = vi.hoisted(() => ({
  props: null as CapturedVirtuosoProps | null,
  scrollToIndex: null as ReturnType<typeof vi.fn> | null,
}));

function virtuosoProps(): CapturedVirtuosoProps {
  if (captured.props === null) throw new Error("Virtuoso has not rendered yet");
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
    bodies: (bodyIds.length > 0 ? bodyIds : [id]).map((bodyId) => ({
      id: bodyId,
      parts: [],
    })),
  };
}

function section(...groups: MessageGroupVM[]): TranscriptSectionVM[] {
  return [{ day: "Dzisiaj", groups }];
}

/** What the list would render for the row with this id. */
function renderedRow(id: string): ReactElement<MessageGroupProps> {
  const row = virtuosoProps().data.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return virtuosoProps().itemContent(0, row);
}

beforeEach(() => {
  captured.props = null;
  captured.scrollToIndex?.mockClear();
});

afterEach(() => vi.useRealTimers());

describe("Transcript rows", () => {
  it("draws the unread line above the first unread block only", () => {
    render(
      <Transcript
        sections={section(group("a"), group("b"), group("c"))}
        label="Wiadomości"
        firstUnreadGroupId="b"
      />,
    );

    expect(virtuosoProps().data.map((row) => row.id)).toEqual([
      "day-Dzisiaj",
      "a",
      "unread-b",
      "b",
      "c",
    ]);
    render(renderedRow("unread-b"));
    expect(screen.getByText("Nowe wiadomości")).toBeInTheDocument();
  });

  it("writes the day heading as its own row", () => {
    render(<Transcript sections={section(group("a"))} label="Wiadomości" />);

    render(renderedRow("day-Dzisiaj"));
    expect(screen.getByText("Dzisiaj")).toBeInTheDocument();
  });

  it("renders the intro inside the list, above the first day", () => {
    render(
      <Transcript
        sections={section(group("a"))}
        label="Wiadomości"
        intro={<p>To początek kanału.</p>}
      />,
    );

    const Header = virtuosoProps().components?.Header;
    if (Header === undefined) throw new Error("no header");
    render(<Header />);
    expect(screen.getByText("To początek kanału.")).toBeInTheDocument();
  });

  it("has no header when there is no intro", () => {
    render(<Transcript sections={section(group("a"))} label="Wiadomości" />);

    expect(virtuosoProps().components?.Header).toBeUndefined();
  });

  it("raises the profile of the author of the block it was clicked on", () => {
    const onOpenAuthor = vi.fn();
    render(
      <Transcript
        sections={section(group("a"))}
        label="Wiadomości"
        onOpenAuthor={onOpenAuthor}
      />,
    );
    const anchor = document.createElement("button");

    renderedRow("a").props.onOpenAuthor?.(anchor);

    expect(onOpenAuthor).toHaveBeenCalledWith("user-1", anchor);
  });

  it("leaves authors inert when nothing can open a profile", () => {
    render(<Transcript sections={section(group("a"))} label="Wiadomości" />);

    expect(renderedRow("a").props.onOpenAuthor).toBeUndefined();
  });
});

describe("Transcript older history", () => {
  function startReachedFor(props: {
    hasOlder?: boolean;
    loadingOlder?: boolean;
    onLoadOlder?: () => void;
  }) {
    render(
      <Transcript
        sections={section(group("a"))}
        label="Wiadomości"
        {...props}
      />,
    );
    return virtuosoProps().startReached;
  }

  it("asks for the next page when the oldest row is reached", () => {
    const onLoadOlder = vi.fn();
    const startReached = startReachedFor({ hasOlder: true, onLoadOlder });

    act(() => startReached?.(1_000_000));

    expect(onLoadOlder).toHaveBeenCalledOnce();
  });

  it("does not ask when there is nothing older", () => {
    expect(startReachedFor({ onLoadOlder: vi.fn() })).toBeUndefined();
  });

  it("does not ask again while a page is already loading", () => {
    expect(
      startReachedFor({ hasOlder: true, loadingOlder: true, onLoadOlder: vi.fn() }),
    ).toBeUndefined();
  });

  it("does not ask when nobody listens", () => {
    expect(startReachedFor({ hasOlder: true })).toBeUndefined();
  });
});

describe("Transcript jumping to a message", () => {
  function mount() {
    vi.useFakeTimers();
    let jumpTo: ((messageId: string) => void) | undefined;
    render(
      <Transcript
        sections={section(group("a"), group("b", "b1", "b2"))}
        label="Wiadomości"
        onJumpReady={(jump) => {
          jumpTo = jump;
        }}
      />,
    );
    if (jumpTo === undefined) throw new Error("the jump was not handed out");
    return jumpTo;
  }

  it("scrolls to the block that holds the message and flashes it", () => {
    const jumpTo = mount();

    act(() => jumpTo("b2"));

    expect(captured.scrollToIndex).toHaveBeenCalledWith({
      index: 2,
      align: "center",
      behavior: "smooth",
    });
    expect(renderedRow("b").props.highlight).toBe(true);
    expect(renderedRow("a").props.highlight).toBe(false);

    act(() => vi.advanceTimersByTime(1_200));
    expect(renderedRow("b").props.highlight).toBe(false);
  });

  it("does nothing for a message that has not been loaded", () => {
    const jumpTo = mount();

    act(() => jumpTo("older"));

    expect(captured.scrollToIndex).not.toHaveBeenCalled();
    expect(renderedRow("a").props.highlight).toBe(false);
  });

  it("is the same function the reply line uses, and is handed out once", () => {
    const onJumpReady = vi.fn();
    const answer = group("answer");
    answer.replyTo = { id: "a", authorId: "u2", authorName: "Nils", preview: "Cześć" };
    const { rerender } = render(
      <Transcript
        sections={section(group("a"), answer)}
        label="Wiadomości"
        onJumpReady={onJumpReady}
      />,
    );

    act(() => renderedRow("answer").props.onOpenReply?.("a"));
    expect(captured.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, align: "center" }),
    );

    rerender(
      <Transcript
        sections={section(group("a"), answer, group("later"))}
        label="Wiadomości"
        onJumpReady={onJumpReady}
      />,
    );
    expect(onJumpReady).toHaveBeenCalledTimes(1);
    expect(onJumpReady.mock.calls[0]?.[0]).toBe(renderedRow("answer").props.onOpenReply);
  });

  it("finds a message that arrived after the jump was handed out", () => {
    let jumpTo: ((messageId: string) => void) | undefined;
    const onJumpReady = (jump: (messageId: string) => void) => {
      jumpTo = jump;
    };
    const { rerender } = render(
      <Transcript sections={section(group("a"))} label="Wiadomości" onJumpReady={onJumpReady} />,
    );
    rerender(
      <Transcript
        sections={section(group("a"), group("b"))}
        label="Wiadomości"
        onJumpReady={onJumpReady}
      />,
    );

    act(() => jumpTo?.("b"));

    expect(captured.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2 }),
    );
  });

  it("leaves reply lines inert inside a thread", () => {
    const answer = group("answer");
    answer.replyTo = { id: "root", authorId: "u2", authorName: "Nils", preview: "Cześć" };
    render(
      <Transcript sections={section(answer)} label="Wątek" hideReplyReferences />,
    );

    expect(renderedRow("answer").props.onOpenReply).toBeUndefined();
  });
});

describe("Transcript arrivals", () => {
  it("marks a block fresh only while it is new, and never on the first render", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Transcript sections={section(group("a"))} label="Wiadomości" />,
    );
    expect(renderedRow("a").props.fresh).toBe(false);

    rerender(
      <Transcript sections={section(group("a"), group("b"))} label="Wiadomości" />,
    );
    expect(renderedRow("b").props.fresh).toBe(true);
    expect(renderedRow("a").props.fresh).toBe(false);

    act(() => vi.advanceTimersByTime(400));
    expect(renderedRow("b").props.fresh).toBe(false);
  });

  it("does not treat the first page of an empty transcript as something missed", () => {
    const { rerender } = render(<Transcript sections={[]} label="Wiadomości" />);
    act(() => virtuosoProps().atBottomStateChange?.(false));

    rerender(<Transcript sections={section(group("a"))} label="Wiadomości" />);

    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Przejdź do najnowszych wiadomości",
    );
  });

  it("goes back to the end and drops the pill's name when it is pressed", () => {
    const { rerender } = render(
      <Transcript sections={section(group("a"))} label="Wiadomości" />,
    );
    act(() => virtuosoProps().atBottomStateChange?.(false));
    rerender(
      <Transcript sections={section(group("a"), group("b"))} label="Wiadomości" />,
    );

    act(() => screen.getByRole("button", { name: /Nowe wiadomości/ }).click());

    expect(captured.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2, align: "end", behavior: "smooth" }),
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Przejdź do najnowszych wiadomości",
    );
  });
});

describe("Transcript opening", () => {
  function scrollerOf(height: number) {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: height },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    return element;
  }

  it("asks the list for the end again when it never reports reaching it", () => {
    vi.useFakeTimers();
    render(<Transcript sections={section(group("a"))} label="Wiadomości" />);
    const scroller = scrollerOf(900);
    act(() => virtuosoProps().scrollerRef?.(scroller));

    act(() => vi.advanceTimersByTime(199));
    expect(captured.scrollToIndex).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(captured.scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end" });
    expect(virtuosoProps().className).toBe("transcript opening");
  });

  it("takes the end as reached when the second request goes unanswered too", () => {
    vi.useFakeTimers();
    render(<Transcript sections={section(group("a"))} label="Wiadomości" />);
    const scroller = scrollerOf(900);
    act(() => virtuosoProps().scrollerRef?.(scroller));

    act(() => vi.advanceTimersByTime(400));
    expect(scroller.scrollTop).toBe(300);
    expect(virtuosoProps().className).toBe("transcript opening");

    act(() => vi.advanceTimersByTime(180));
    expect(virtuosoProps().className).toBe("transcript");
  });

  it("does not interfere once the list reported the bottom by itself", () => {
    vi.useFakeTimers();
    render(<Transcript sections={section(group("a"))} label="Wiadomości" />);
    act(() => virtuosoProps().atBottomStateChange?.(true));
    act(() => vi.advanceTimersByTime(180));

    act(() => vi.advanceTimersByTime(1_000));

    expect(captured.scrollToIndex).not.toHaveBeenCalled();
  });
});
