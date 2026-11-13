"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** The longest exit the package draws, with room to spare; a stuck element still leaves. */
const EXIT_LIMIT_MS = 1000;

/**
 * Keeps an element mounted after `open` turns false for as long as its exit
 * animation runs.
 *
 * The element gets `data-state="closed"` for that time, which is what starts
 * the animation in CSS. When the closed state animates nothing (no
 * stylesheet, as under jsdom, or a part that has no exit) it leaves in the
 * same commit, before the browser paints.
 *
 * Render the element only while `present` is true, attach `ref` to it, and set
 * its `data-state` to `open` or `closed` from the same `open` that is passed
 * here.
 */
export function usePresence<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  useLayoutEffect(() => {
    if (open || !present) return;
    const node = ref.current;
    const name = node === null ? "" : getComputedStyle(node).animationName;
    if (node === null || name === "" || name === "none") {
      setPresent(false);
      return;
    }

    const leave = (event: AnimationEvent) => {
      if (event.target === node) setPresent(false);
    };
    const timer = window.setTimeout(() => setPresent(false), EXIT_LIMIT_MS);
    node.addEventListener("animationend", leave);
    node.addEventListener("animationcancel", leave);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener("animationend", leave);
      node.removeEventListener("animationcancel", leave);
    };
  }, [open, present]);

  return { present, ref };
}
