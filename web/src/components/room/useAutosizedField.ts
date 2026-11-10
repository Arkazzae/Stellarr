"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * The textarea stops growing at eight rows. `composer.css` caps it at
 * `calc(1.6em * 8)`; this is the same number in pixels (15px font-size times
 * the 1.6 line-height declared there), because `scrollHeight` has to be
 * clamped before it is written back as a height.
 */
const MAX_ROWS = 8;
const ROW_PX = 24;

function fit(element: HTMLTextAreaElement | null) {
  if (element === null) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, MAX_ROWS * ROW_PX)}px`;
}

/**
 * Keeps a textarea as tall as its text, up to eight rows.
 *
 * `scope` names the place the field is used in. It is a dependency on purpose:
 * leaving a narrower thread must discard the height measured for that layout
 * even if React reuses the same field before its text changes.
 */
export function useAutosizedField(
  field: RefObject<HTMLTextAreaElement | null>,
  text: string,
  scope: string | null,
) {
  // Measure-then-set has to happen before paint, or the box visibly jumps a
  // frame behind the caret.
  useLayoutEffect(() => {
    fit(field.current);
  }, [field, text, scope]);

  // A thread can also be expanded or restored without the draft changing.
  // Refit only when the box changes width; observing height as well would make
  // our own adjustment feed back into the observer.
  useEffect(() => {
    const box = field.current?.parentElement;
    if (box == null || typeof ResizeObserver === "undefined") return;
    let width = box.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      fit(field.current);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [field, scope]);
}
