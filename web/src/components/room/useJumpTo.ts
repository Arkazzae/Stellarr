import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import { indexOfMessage, type Row } from "./transcriptRows";

const FLASH_MS = 1200;

/**
 * "Go to this message", for the reply line and for whoever is outside the
 * transcript.
 *
 * The list is windowed, so the scroll is an index rather than an element, and
 * the block is flashed on arrival because a silent jump leaves the reader
 * looking for what moved. A message older than the loaded window has no index
 * yet; nothing happens, which is better than something wrong.
 *
 * The function handed out is one function for the life of the component, so
 * it reads the rows through a ref instead of closing over the render it was
 * created in.
 */
export function useJumpTo(
  rows: readonly Row[],
  virtuoso: RefObject<VirtuosoHandle | null>,
  onJumpReady: ((jumpTo: (messageId: string) => void) => void) | undefined,
) {
  const [flashId, setFlashId] = useState<string | null>(null);
  const currentRows = useRef(rows);

  // After the commit, not during it: a jump is only ever made from an event,
  // which cannot happen before this render has been painted.
  useEffect(() => {
    currentRows.current = rows;
  }, [rows]);

  const jumpTo = useCallback(
    (messageId: string) => {
      const index = indexOfMessage(currentRows.current, messageId);
      const row = currentRows.current[index];
      if (row?.kind !== "group") return;
      virtuoso.current?.scrollToIndex({
        index,
        align: "center",
        behavior: "smooth",
      });
      setFlashId(row.id);
    },
    [virtuoso],
  );

  useEffect(() => {
    onJumpReady?.(jumpTo);
  }, [onJumpReady, jumpTo]);

  useEffect(() => {
    if (flashId === null) return;
    const timer = window.setTimeout(() => setFlashId(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  return { flashId, jumpTo };
}
