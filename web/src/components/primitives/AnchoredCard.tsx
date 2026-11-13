"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useLayer } from "@stellarr/ui/behavior";

import { focusWithin, trapTab } from "./focus";

/** Between the anchor and the card. */
const GAP = 8;
/** The least room the card leaves to the edge of the window. */
const EDGE = 12;

export interface AnchoredCardProps {
  /**
   * The control the card hangs off: the element rather than a rectangle, so the
   * card can follow it while the page scrolls and leave when it is unmounted.
   */
  anchor: HTMLElement;
  onClose: () => void;
  /** Names the card for assistive tech; it is a dialog, so it needs one. */
  label: string;
  className?: string;
  /**
   * Move focus into the card on mount. A catalogue opened by touch turns this
   * off so its first text field does not summon the software keyboard.
   */
  autoFocus?: boolean;
  children: ReactNode;
}

interface Placement {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

interface ViewportBox {
  width: number;
  height: number;
  /** Where the visual viewport starts while the page is zoomed or panned. */
  offsetLeft: number;
  offsetTop: number;
  /** Safe-area insets: notches, home indicators and rounded corners. */
  insetTop: number;
  insetRight: number;
  insetBottom: number;
  insetLeft: number;
}

/**
 * Where the card goes.
 *
 * Beside the anchor rather than under it: what raises a card (a member row, an
 * avatar in the transcript) sits in a narrow column at the edge of the window,
 * and a card below it would cover the list it came from. It opens to the right,
 * flips to the left when the right cannot hold it, and only then falls back to
 * clamping inside the window. Vertically it aligns with the top of the anchor
 * and is pushed back inside; a card taller than the window scrolls internally.
 */
export function placeAnchoredCard(
  anchor: Pick<DOMRect, "left" | "right" | "top">,
  card: { width: number; height: number },
  view: ViewportBox,
): Placement {
  const minLeft = view.offsetLeft + Math.max(EDGE, view.insetLeft);
  const maxRight = view.offsetLeft + view.width - Math.max(EDGE, view.insetRight);
  const minTop = view.offsetTop + Math.max(EDGE, view.insetTop);
  const maxBottom = view.offsetTop + view.height - Math.max(EDGE, view.insetBottom);

  const maxWidth = Math.max(0, maxRight - minLeft);
  const maxHeight = Math.max(0, maxBottom - minTop);
  const width = Math.min(card.width, maxWidth);
  const height = Math.min(card.height, maxHeight);

  const right = anchor.right + GAP;
  const left = anchor.left - GAP - width;
  let x: number;
  if (right + width <= maxRight) x = right;
  else if (left >= minLeft) x = left;
  else x = Math.max(minLeft, Math.min(anchor.left, maxRight - width));

  const y = Math.max(minTop, Math.min(anchor.top, maxBottom - height));

  return { left: x, top: y, maxWidth, maxHeight };
}

function cssPixels(style: CSSStyleDeclaration, property: string): number {
  const value = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * A floating card tied to the control that opened it.
 *
 * Unlike `Popover`, which CSS positions inside the region it belongs to, this
 * one portals to `<body>` so it escapes the roster's `overflow: hidden` and the
 * transcript's virtualiser, then measures itself and places itself against the
 * anchor's rectangle.
 *
 * It is a dialog for assistive tech: focus moves in, Escape and a click
 * elsewhere close it (as a layer on the shared stack, when no layer above it
 * takes them), and focus returns to the anchor. `aria-modal` is left off
 * on purpose, because nothing behind the card is inert.
 */
export function AnchoredCard({
  anchor,
  onClose,
  label,
  className,
  autoFocus = true,
  children,
}: AnchoredCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const reposition = useCallback(() => {
    const card = cardRef.current;
    if (card === null) return;
    // The anchor is gone (its message was recycled, the person left the call),
    // so there is nothing left to point at.
    if (!anchor.isConnected) {
      onClose();
      return;
    }
    const style = window.getComputedStyle(card);
    const viewport = window.visualViewport;
    const next = placeAnchoredCard(
      anchor.getBoundingClientRect(),
      { width: card.offsetWidth, height: card.offsetHeight },
      {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        offsetLeft: viewport?.offsetLeft ?? 0,
        offsetTop: viewport?.offsetTop ?? 0,
        insetTop: cssPixels(style, "--anchored-safe-top"),
        insetRight: cssPixels(style, "--anchored-safe-right"),
        insetBottom: cssPixels(style, "--anchored-safe-bottom"),
        insetLeft: cssPixels(style, "--anchored-safe-left"),
      },
    );
    // Scroll fires this at frame rate; an unchanged placement must not render.
    setPlacement((current) =>
      current !== null &&
      current.left === next.left &&
      current.top === next.top &&
      current.maxWidth === next.maxWidth &&
      current.maxHeight === next.maxHeight
        ? current
        : next,
    );
  }, [anchor, onClose]);

  // Measure before the first paint: the card renders hidden until it has a
  // placement, and measuring after paint would flash it in the corner.
  useLayoutEffect(reposition, [reposition]);

  useEffect(() => {
    // Captured, so scrolling any ancestor (the roster, the transcript) moves
    // the card and not just scrolling the window.
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    const observer = new ResizeObserver(reposition);
    if (cardRef.current !== null) observer.observe(cardRef.current);
    return () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, [reposition]);

  useEffect(() => {
    if (autoFocus) focusWithin(cardRef.current);
    return () => {
      // If the anchor left the page, focus stays on <body> rather than moving
      // somewhere arbitrary.
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchor, autoFocus]);

  useLayer(true, {
    node: () => cardRef.current,
    // The anchor toggles the card itself; closing on a press there too would
    // make a second click on it reopen what the click meant to dismiss.
    owns: (target) => cardRef.current?.contains(target) === true || anchor.contains(target),
    onEscape: () => {
      onClose();
    },
    onTab: (event) => {
      if (cardRef.current !== null) trapTab(event, cardRef.current);
    },
    onPointerDownOutside: () => {
      onClose();
    },
  });

  return createPortal(
    <div
      ref={cardRef}
      className={className === undefined ? "anchored" : `anchored ${className}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={placement ?? { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
