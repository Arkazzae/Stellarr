"use client";

import type { RefObject } from "react";

import { useLayer } from "@stellarr/ui/behavior";

interface Options {
  /** A press here belongs to the popover and does not dismiss it. */
  isInside(target: Node): boolean;
  onDismiss(): void;
  /** Where focus goes when Escape closes it. A press elsewhere takes focus itself. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * Closes a popover on a press outside it or on Escape, while it is `open`.
 *
 * While open the popover is a layer on the shared stack, so one Escape closes
 * only the topmost layer and a press outside reaches only the topmost layer
 * that listens for one. That keeps a press or a key from also closing whatever
 * sits behind the composer.
 */
export function useDismissible(open: boolean, options: Options) {
  useLayer(open, {
    // `owns` answers for every press, so there is no single element to name.
    node: () => null,
    owns: (target) => options.isInside(target),
    onEscape: () => {
      options.onDismiss();
      options.returnFocusTo?.current?.focus();
    },
    onPointerDownOutside: () => {
      options.onDismiss();
    },
  });
}
