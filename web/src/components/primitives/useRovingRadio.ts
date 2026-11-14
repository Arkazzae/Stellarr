"use client";

import { useRef, type KeyboardEvent } from "react";

const STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The keyboard of a radio group drawn by hand: one tab stop, on the chosen
 * item or the first, and the arrows (Home and End too) move focus and choose
 * in the same step, the way `Segmented` and the native group behave.
 */
export function useRovingRadio(count: number, selected: number, choose: (index: number) => void) {
  const items = useRef<(HTMLElement | null)[]>([]);
  const tabStop = Math.max(selected, 0);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, from: number) => {
    const step = STEP[event.key];
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? count - 1
          : step === undefined
            ? null
            : (from + step + count) % count;
    if (to === null || count === 0) return;
    event.preventDefault();
    items.current[to]?.focus();
    choose(to);
  };

  return {
    tabIndex: (index: number) => (index === tabStop ? 0 : -1),
    ref: (index: number) => (node: HTMLElement | null) => {
      items.current[index] = node;
    },
    onKeyDown,
  };
}
