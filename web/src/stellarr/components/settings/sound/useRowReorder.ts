import {
  useEffect,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefCallback,
} from "react";
import { flushSync } from "react-dom";

import { edgeScrollSpeed } from "@/lib/drag/geometry";
import { restoreFocus } from "@/lib/drag/keyboard";
import { holdFingerOn, trackPointer, type PointerDrag } from "@/lib/drag/pointer";

export interface RowReorderOptions {
  /** The rows, in the order they are on the page. */
  ids: readonly string[];
  /**
   * A row was moved: the whole new order and the row that moved. The rows
   * have to be rendered in the new order when it returns.
   */
  onMove: (order: string[], id: string) => void;
}

/** A row carried by the pointer, measured once when it was lifted. */
interface Carry {
  id: string;
  ids: readonly string[];
  from: number;
  to: number;
  list: HTMLElement;
  rows: HTMLElement[];
  /** Where each row starts in the list, and how tall it is, without transforms. */
  tops: number[];
  heights: number[];
  /** How far below its row's top the row was taken hold of. */
  grip: number;
  /** The pointer's latest height in the viewport. */
  y: number;
  finger: boolean;
  scroller: HTMLElement | null;
  frame: number;
  pointer: PointerDrag | null;
  listening: AbortController;
}

function moved(ids: readonly string[], from: number, to: number): string[] {
  const order = [...ids];
  const [id] = order.splice(from, 1);
  if (id !== undefined) order.splice(to, 0, id);
  return order;
}

/** The nearest ancestor that scrolls vertically, which the pointer scrolls at its edges. */
function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

/**
 * Reorders the rows of one short list; see `useRowReorder`. While a row is
 * carried nothing is rendered: the rows are moved with transforms written
 * straight to the page, and the owner hears only the drop.
 */
function createRowReorder() {
  let options: RowReorderOptions = { ids: [], onMove: () => {} };
  let list: HTMLElement | null = null;
  const rows = new Map<string, HTMLElement>();
  const handles = new Map<string, HTMLElement>();
  const refs = new Map<string, RefCallback<HTMLElement>>();
  let carry: Carry | null = null;

  /** A ref callback per element, the same every render, so React does not detach and attach it. */
  const cached = (key: string, make: () => RefCallback<HTMLElement>) => {
    let ref = refs.get(key);
    if (ref === undefined) {
      ref = make();
      refs.set(key, ref);
    }
    return ref;
  };

  /** Moves the carried row to the pointer and the others out of its way. */
  const place = (current: Carry) => {
    const { from, tops, heights } = current;
    const top = tops[from] ?? 0;
    const height = heights[from] ?? 0;
    const listTop = current.list.getBoundingClientRect().top;
    const last = current.rows.length - 1;
    const bottom = (tops[last] ?? 0) + (heights[last] ?? 0);
    // The row stays inside the list, so it can always land somewhere.
    const offset = Math.min(
      bottom - top - height,
      Math.max(-top, current.y - listTop - current.grip - top),
    );
    const middle = top + height / 2 + offset;
    let to = from;
    for (let index = from + 1; index < current.rows.length; index += 1) {
      if (middle > (tops[index] ?? 0) + (heights[index] ?? 0) / 2) to = index;
    }
    for (let index = from - 1; index >= 0; index -= 1) {
      if (middle < (tops[index] ?? 0) + (heights[index] ?? 0) / 2) to = index;
    }
    current.to = to;
    current.rows.forEach((row, index) => {
      const shift =
        index === from
          ? offset
          : from < index && index <= to
            ? -height
            : to <= index && index < from
              ? height
              : 0;
      row.style.transform = shift === 0 ? "" : `translateY(${shift}px)`;
    });
  };

  /** Scrolls the list's scroller while the pointer holds near its top or bottom edge. */
  const edgeScroll = (current: Carry) => {
    const scroller = current.scroller;
    if (scroller === null || current.frame !== 0) return;
    const box = scroller.getBoundingClientRect();
    const speed = edgeScrollSpeed(current.y, { top: box.top, bottom: box.bottom });
    if (speed === 0) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      if (carry !== current) return;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + Math.sign(speed) * Math.max(1, Math.round(Math.abs(speed)));
      if (scroller.scrollTop === before) return;
      place(current);
      edgeScroll(current);
    });
  };

  const finish = (dropped: boolean) => {
    const current = carry;
    if (current === null) return;
    carry = null;
    if (current.frame !== 0) cancelAnimationFrame(current.frame);
    current.listening.abort();
    for (const row of current.rows) {
      row.style.transform = "";
      delete row.dataset.drag;
    }
    delete current.list.dataset.dragging;
    if (!dropped || current.to === current.from) return;
    // Rendered in the new order before the browser paints the rows without
    // their transforms, so nothing jumps back on the way.
    const order = moved(current.ids, current.from, current.to);
    flushSync(() => options.onMove(order, current.id));
  };

  const lift = (id: string, pressedAt: number, finger: boolean): Carry | null => {
    const { ids } = options;
    const from = ids.indexOf(id);
    const found = ids.map((rowId) => rows.get(rowId));
    if (list === null || from === -1 || found.some((row) => row === undefined)) return null;
    const present = found as HTMLElement[];
    const tops = present.map((row) => row.offsetTop);
    const lifted: Carry = {
      id,
      ids,
      from,
      to: from,
      list,
      rows: present,
      tops,
      heights: present.map((row) => row.offsetHeight),
      grip: pressedAt - list.getBoundingClientRect().top - (tops[from] ?? 0),
      y: pressedAt,
      finger,
      scroller: scrollerOf(list),
      frame: 0,
      pointer: null,
      listening: new AbortController(),
    };
    list.dataset.dragging = "";
    present[from]!.dataset.drag = "carried";
    // The wheel moves the list under a pointer that holds still.
    lifted.scroller?.addEventListener("scroll", () => place(lifted), {
      signal: lifted.listening.signal,
    });
    carry = lifted;
    return lifted;
  };

  const pressPointer = (id: string, event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || carry !== null) return;
    const pressedAt = event.clientY;
    const finger = event.pointerType === "touch";
    let current: Carry | null = null;
    const press = trackPointer(event.nativeEvent, event.currentTarget, {
      onStart: () => {
        current = lift(id, pressedAt, finger);
        if (current === null) press.cancel();
        else current.pointer = press;
      },
      onMove: (y) => {
        if (current === null || carry !== current) return;
        current.y = y;
        place(current);
        edgeScroll(current);
      },
      onDrop: () => {
        if (current !== null && carry === current) finish(true);
      },
      onCancel: () => {
        if (current !== null && carry === current) finish(false);
      },
    });
  };

  const keyDown = (id: string, event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (carry !== null) return;
    const { ids } = options;
    const from = ids.indexOf(id);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (from === -1 || to < 0 || to >= ids.length) return;
    flushSync(() => options.onMove(moved(ids, from, to), id));
    // Moving a node out of its place can take focus away from it.
    restoreFocus(handles.get(id) ?? null);
  };

  return {
    configure: (next: RowReorderOptions) => {
      options = next;
    },
    /**
     * After every render. Someone else changing the list under a carried row
     * ends the carry: the places it measured are gone.
     */
    committed: () => {
      const { ids } = options;
      if (carry === null) return;
      const same =
        carry.ids.length === ids.length && carry.ids.every((id, index) => ids[index] === id);
      if (!same) carry.pointer?.cancel();
    },
    dispose: () => carry?.pointer?.cancel(),
    /** On the list, which has to be positioned. */
    list: (node: HTMLElement | null) => {
      list = node;
    },
    /** On each row, the element that moves. */
    row: (id: string) =>
      cached(`row:${id}`, () => (node: HTMLElement | null) => {
        if (node === null) rows.delete(id);
        else rows.set(id, node);
      }),
    /** Spread on each row's handle, a button. */
    handle: (id: string) => ({
      ref: cached(`handle:${id}`, () => (node: HTMLElement | null) => {
        if (node === null) return;
        handles.set(id, node);
        // A finger that lifted a row must not scroll the pane instead.
        const release = holdFingerOn(node, () => carry?.finger === true);
        return () => {
          release();
          if (handles.get(id) === node) handles.delete(id);
        };
      }),
      onPointerDown: (event: PointerEvent<HTMLElement>) => pressPointer(id, event),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyDown(id, event),
    }),
  };
}

/**
 * Reorders the rows of one short list, by dragging a row's handle or by the
 * arrow keys on it. The handle is a button: a mouse press has to travel a few
 * pixels and a finger has to hold still for a moment before the row lifts,
 * Escape puts it back, and Arrow Up or Down moves it one place at once.
 *
 * `list` goes on the list, which has to be positioned, `row` on each row and
 * `handle` on each row's handle.
 */
export function useRowReorder({ ids, onMove }: RowReorderOptions) {
  const [reorder] = useState(createRowReorder);

  useLayoutEffect(() => {
    reorder.configure({ ids, onMove });
    reorder.committed();
  });

  useEffect(() => () => reorder.dispose(), [reorder]);

  return reorder;
}
