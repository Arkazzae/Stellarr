import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import type { MessageTail } from "./transcriptRows";

/**
 * Virtuoso confirms an imperative scroll after 150 ms without another size
 * change. Revealing the opening position slightly later keeps its own
 * four-frame initial scroll and our final one-pixel correction from racing.
 */
const QUIET_MS = 180;
/** How long Virtuoso gets to report the bottom before it is asked again. */
const FALLBACK_MS = 200;

/**
 * Where the opening scroll stands.
 *
 * `travelling`: Virtuoso is still on its way to the last row and owns the
 * scroller; writing `scrollTop` now races its delayed alignment, which is what
 * used to land a refresh at seemingly random places.
 * `pinning`: it arrived. Every measurement re-pins the exact bottom and
 * restarts the quiet window, and only when that stays quiet is the list shown.
 * `open`: settled; from here on the reader is in charge.
 */
type Phase = "travelling" | "pinning" | "open";

interface Options {
  virtuoso: RefObject<VirtuosoHandle | null>;
  tail: MessageTail;
  /** Changes when the reader sends something of their own. */
  followOwnSend: number | undefined;
}

/**
 * Keeps the real scroller where the reader expects it: at the end when the
 * transcript opens, at the end for messages that arrive while they are at the
 * end, and at the end for anything they send themselves.
 */
export function useTranscriptScroll({ virtuoso, tail, followOwnSend }: Options) {
  const scroller = useRef<HTMLElement | null>(null);
  const lastScrollHeight = useRef<number | null>(null);
  const phase = useRef<Phase>("travelling");
  const quietTimer = useRef<number | null>(null);
  /** Virtuoso's own idea of "at the end", before the arrival-following veto. */
  const atBottomRef = useRef(true);
  /** A message was followed and its row may still grow (media, embeds). */
  const following = useRef(false);
  const previousTail = useRef(tail);
  const lastOwnSend = useRef(followOwnSend);

  const [ready, setReady] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const toBottom = useCallback(() => {
    const element = scroller.current;
    if (element === null) return;
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    lastScrollHeight.current = element.scrollHeight;
  }, []);

  // Close the pixel gap, then wait for measurements to stop before revealing.
  const pin = useCallback(() => {
    toBottom();
    if (quietTimer.current !== null) window.clearTimeout(quietTimer.current);
    quietTimer.current = window.setTimeout(() => {
      quietTimer.current = null;
      toBottom();
      phase.current = "open";
      setReady(true);
    }, QUIET_MS);
  }, [toBottom]);

  const reachBottom = useCallback(() => {
    if (phase.current === "open") return;
    phase.current = "pinning";
    pin();
  }, [pin]);

  const setScroller = useCallback((element: HTMLElement | Window | null) => {
    scroller.current = element instanceof HTMLElement ? element : null;
    lastScrollHeight.current = scroller.current?.scrollHeight ?? null;
  }, []);

  const onTotalListHeightChanged = useCallback(() => {
    const element = scroller.current;
    if (element === null) return;

    const bottomFor = (height: number) =>
      Math.max(0, height - element.clientHeight);
    const wasAtBottom =
      lastScrollHeight.current !== null &&
      Math.abs(element.scrollTop - bottomFor(lastScrollHeight.current)) <= 1;
    const nowAtBottom =
      Math.abs(element.scrollTop - bottomFor(element.scrollHeight)) <= 1;
    lastScrollHeight.current = element.scrollHeight;

    if (phase.current === "travelling") return;
    if (phase.current === "pinning") {
      pin();
      return;
    }
    // Exact rather than thresholded: a reader 20 px above the end is left
    // alone, while media that finishes loading under someone at the end is
    // followed.
    if (wasAtBottom && !nowAtBottom) toBottom();
  }, [pin, toBottom]);

  const onAtBottomStateChange = useCallback(
    (bottom: boolean) => {
      if (bottom) reachBottom();
      atBottomRef.current = bottom;
      // The row is growing under a followed message, which briefly reads as
      // "away" until the scroller catches up. The reader did not leave.
      if (!bottom && following.current) return;
      setAtBottom(bottom);
      if (bottom) following.current = false;
    },
    [reachBottom],
  );

  /*
   * A second message from the same author grows the existing row instead of
   * adding one, which Virtuoso's follow mode would only chase after the fact.
   * Moving the real scroller here happens before the taller row paints.
   * Swapping an optimistic id for the server's keeps the count, so it cannot
   * count as a second arrival.
   */
  useLayoutEffect(() => {
    const previous = previousTail.current;
    previousTail.current = tail;
    const arrived =
      tail.count > previous.count &&
      tail.lastMessageId !== previous.lastMessageId;
    if (!arrived || !(atBottomRef.current || following.current)) return;
    following.current = true;
    toBottom();
  }, [tail, toBottom]);

  /*
   * Sending commands the view even from further up, where an arrival would
   * not. Mounting is not a send, and the opening position belongs to Virtuoso.
   */
  useLayoutEffect(() => {
    if (followOwnSend === lastOwnSend.current) return;
    lastOwnSend.current = followOwnSend;
    if (phase.current !== "open") return;
    following.current = true;
    toBottom();
  }, [followOwnSend, toBottom]);

  // If Virtuoso never reports the bottom, ask it again, then take it as given.
  useEffect(() => {
    let timer = window.setTimeout(() => {
      if (phase.current !== "travelling") return;
      virtuoso.current?.scrollToIndex({ index: "LAST", align: "end" });
      timer = window.setTimeout(() => {
        if (phase.current === "travelling") reachBottom();
      }, FALLBACK_MS);
    }, FALLBACK_MS);

    return () => {
      window.clearTimeout(timer);
      if (quietTimer.current !== null) window.clearTimeout(quietTimer.current);
    };
  }, [virtuoso, reachBottom]);

  return { ready, atBottom, setScroller, onTotalListHeightChanged, onAtBottomStateChange };
}
