import { useRef, useState } from "react";

import type { Row } from "./transcriptRows";

/**
 * Virtuoso counts rows from `firstItemIndex`; lowering it by the number of
 * rows prepended is how it keeps the reader's place when history loads above.
 * Starting high leaves room to go down without ever going negative.
 */
const INITIAL_FIRST_ITEM_INDEX = 1_000_000;

/** A row as the window sees it. Only messages can anchor the reader's place. */
interface WindowRow {
  id: string;
  anchor: boolean;
}

export interface HistoryWindow {
  rows: WindowRow[];
  firstItemIndex: number;
}

function windowRows(rows: readonly Row[]): WindowRow[] {
  return rows.map((row) => ({ id: row.id, anchor: row.kind === "group" }));
}

export function initialHistoryWindow(rows: readonly Row[]): HistoryWindow {
  return { rows: windowRows(rows), firstItemIndex: INITIAL_FIRST_ITEM_INDEX };
}

function sameRows(a: readonly WindowRow[], b: readonly WindowRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.id === b[i]?.id && row.anchor === b[i]?.anchor)
  );
}

/** `from` first, then onwards to the end, then backwards towards the start. */
function* nearestFirst(from: number, length: number): Generator<number> {
  for (let i = from; i < length; i += 1) yield i;
  for (let i = from - 1; i >= 0; i -= 1) yield i;
}

/**
 * Moves the absolute window so a message the reader can see keeps its absolute
 * index after the rows change.
 *
 * Counting only the prepended rows is wrong as soon as a live message arrives
 * at the bottom during the request, or a page boundary merges two author
 * groups. Instead, a message that survives in the new list is located near the
 * viewport's leading edge, and the shift is the distance it moved; Virtuoso
 * does the pixel compensation from its own measurements. Separators are never
 * the anchor: older messages can land inside the same day and leave the
 * separator's index unchanged while the reading position moved.
 */
export function advanceHistoryWindow(
  previous: HistoryWindow,
  nextRows: readonly Row[],
  visibleStartIndex: number | null,
): HistoryWindow {
  const rows = windowRows(nextRows);
  if (sameRows(previous.rows, rows)) return previous;

  const newIndexById = new Map(rows.map((row, index) => [row.id, index]));
  const lastIndex = previous.rows.length - 1;
  const visible =
    visibleStartIndex === null
      ? lastIndex
      : visibleStartIndex - previous.firstItemIndex;
  const start = Math.max(0, Math.min(lastIndex, visible));

  for (const oldIndex of nearestFirst(start, previous.rows.length)) {
    const old = previous.rows[oldIndex];
    const newIndex = old?.anchor ? newIndexById.get(old.id) : undefined;
    if (newIndex === undefined) continue;
    return {
      rows,
      firstItemIndex: previous.firstItemIndex + oldIndex - newIndex,
    };
  }
  return { rows, firstItemIndex: previous.firstItemIndex };
}

/**
 * The virtual list's absolute first index, kept in step with the rows.
 *
 * The visible start is a ref because it changes on every scroll; it is
 * published as state only when history is requested, so the render that
 * receives the older page has a stable anchor to read.
 */
export function useHistoryWindow(rows: readonly Row[]) {
  const visibleStart = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [current, setCurrent] = useState(() => initialHistoryWindow(rows));

  const next = advanceHistoryWindow(current, rows, anchor);
  if (next !== current) setCurrent(next);

  return {
    firstItemIndex: current.firstItemIndex,
    noteVisibleStart(startIndex: number) {
      visibleStart.current = startIndex;
    },
    anchorHere() {
      setAnchor(visibleStart.current);
    },
  };
}
