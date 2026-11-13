/** Which side of the anchor the floating element goes on. */
export type Side = "top" | "bottom";

/** Which edge of the anchor the floating element lines up with. */
export type Align = "start" | "center" | "end";

export interface PlaceOptions {
  /** The side to try first. */
  side: Side;
  /** Where along the anchor the element sits. */
  align: Align;
  /** Between the anchor and the floating element, in pixels. */
  offset: number;
}

export interface Placement {
  /** The element's left edge, in viewport pixels. */
  left: number;
  /** The element's top edge, in viewport pixels. */
  top: number;
  /** The side it ended up on: the asked one, unless only the other has room. */
  side: Side;
  /** The room on that side, for the element's `max-height`. */
  availableHeight: number;
}

/**
 * The element's laid-out size, unaffected by a transform such as the scale of
 * an entrance animation. Fractional where the layout is, so an end-aligned
 * list lines up with its trigger exactly; whole pixels only where the computed
 * size is not the box (an inline element, say).
 *
 * The element must be rendered, so measure it after it mounts and before it is
 * placed, in a layout effect.
 */
export function measure(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  const width = parseFloat(style.width) || 0;
  const height = parseFloat(style.height) || 0;
  const fits = Math.round(width) === element.offsetWidth && Math.round(height) === element.offsetHeight;
  return fits ? { width, height } : { width: element.offsetWidth, height: element.offsetHeight };
}

/**
 * Rounds a length in CSS pixels to the nearest device pixel, so the edges of
 * what is placed stay sharp. Apply it to `left` and `top` from `place`, not to
 * the size.
 */
export function snap(value: number): number {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

/**
 * Where a menu or a tooltip goes beside its anchor, in viewport pixels.
 *
 * It takes the asked side and flips only when that side cannot hold it and
 * the other has more room, then slides along the anchor to stay inside the
 * window.
 *
 * It only calculates. The caller measures the element (`measure`), passes the
 * anchor's `getBoundingClientRect()` and the window's size, writes `left` and
 * `top` to a fixed-position element, and sets `availableHeight` as its
 * `max-height` where the element may be taller than the room. Do it again when
 * the window resizes or scrolls.
 */
export function place(
  anchor: DOMRect,
  size: { width: number; height: number },
  view: { width: number; height: number },
  { side, align, offset }: PlaceOptions,
): Placement {
  const room: Record<Side, number> = {
    bottom: view.height - anchor.bottom - offset,
    top: anchor.top - offset,
  };
  const other: Side = side === "bottom" ? "top" : "bottom";
  const chosen = size.height > room[side] && room[other] > room[side] ? other : side;
  const height = Math.min(size.height, Math.max(room[chosen], 0));

  const left =
    align === "start"
      ? anchor.left
      : align === "end"
        ? anchor.right - size.width
        : anchor.left + anchor.width / 2 - size.width / 2;

  return {
    left: Math.max(0, Math.min(left, view.width - size.width)),
    top: chosen === "bottom" ? anchor.bottom + offset : anchor.top - offset - height,
    side: chosen,
    availableHeight: Math.max(room[chosen], 0),
  };
}
