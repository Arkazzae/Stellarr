"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

interface Options {
  /** A press here belongs to the popover and does not dismiss it. */
  isInside(target: Node): boolean;
  onDismiss(): void;
  /** Where focus goes when Escape closes it. A press elsewhere takes focus itself. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /**
   * Return false to leave Escape to something else that is open on top, such
   * as a picker with its own handler. Defaults to claiming every Escape.
   */
  claimsEscape?(): boolean;
}

/**
 * Closes a popover on a press outside it or on Escape, while it is `open`.
 *
 * Escape is stopped here so it does not also close whatever sits behind the
 * composer.
 */
export function useDismissible(open: boolean, options: Options) {
  const onPress = useEffectEvent((event: PointerEvent) => {
    const { target } = event;
    if (target instanceof Node && !options.isInside(target)) options.onDismiss();
  });
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || options.claimsEscape?.() === false) return;
    event.stopPropagation();
    options.onDismiss();
    options.returnFocusTo?.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    const pressed = (event: PointerEvent) => onPress(event);
    const keyed = (event: KeyboardEvent) => onKey(event);
    document.addEventListener("pointerdown", pressed);
    document.addEventListener("keydown", keyed);
    return () => {
      document.removeEventListener("pointerdown", pressed);
      document.removeEventListener("keydown", keyed);
    };
  }, [open]);
}
