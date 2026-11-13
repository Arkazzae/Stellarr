"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "../cx";
import { useLayer } from "../internal/layers";
import { measure, place, snap, type Align, type Side } from "../internal/place";
import { useComposedRefs } from "../internal/refs";
import { Slot } from "../internal/slot";

/** Time to move the pointer from the trigger onto the note without it closing. */
const GRACE_MS = 150;

interface TooltipContextValue {
  open: boolean;
  /** Opens after the delay, for a pointer resting on the trigger. */
  openSoon: () => void;
  openNow: () => void;
  close: () => void;
  /** Closes unless the pointer reaches the note first. */
  closeSoon: () => void;
  keepOpen: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  contentId: string;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltip(): TooltipContextValue {
  const context = useContext(TooltipContext);
  if (context === null) throw new Error("Tooltip parts must sit inside <Tooltip>.");
  return context;
}

export interface TooltipProps {
  /** How long the pointer rests on the trigger before the note opens. Focus opens it at once. */
  delayDuration?: number;
  children?: ReactNode;
}

/**
 * A short note on a control, for the pointer and the keyboard alike. Touch has
 * no hover, so what it says must also be reachable another way.
 */
export function Tooltip({ delayDuration = 300, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();

  const after = (ms: number, then: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(then, ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const value: TooltipContextValue = {
    open,
    openSoon: () => after(delayDuration, () => setOpen(true)),
    openNow: () => {
      window.clearTimeout(timer.current);
      setOpen(true);
    },
    close: () => {
      window.clearTimeout(timer.current);
      setOpen(false);
    },
    closeSoon: () => after(GRACE_MS, () => setOpen(false)),
    keepOpen: () => window.clearTimeout(timer.current),
    triggerRef,
    contentId,
  };

  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
}

export interface TooltipTriggerProps extends ComponentProps<"button"> {
  /** Gives the one child element, usually a Button, the trigger's behaviour. */
  asChild?: boolean;
}

export function TooltipTrigger({
  asChild,
  ref,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onClick,
  ...props
}: TooltipTriggerProps) {
  const tooltip = useTooltip();
  const composedRef = useComposedRefs<HTMLButtonElement>(ref, tooltip.triggerRef as RefObject<HTMLButtonElement | null>);
  // A press focuses the trigger too; that focus is the press, not a reason to open.
  const pressing = useRef(false);

  const shared = {
    ref: composedRef,
    "aria-describedby": tooltip.open ? tooltip.contentId : undefined,
    "data-state": tooltip.open ? "open" : "closed",
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
      onPointerEnter?.(event);
      if (event.pointerType !== "touch") tooltip.openSoon();
    },
    onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => {
      onPointerLeave?.(event);
      tooltip.closeSoon();
    },
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      pressing.current = true;
      document.addEventListener("pointerup", () => (pressing.current = false), { once: true });
      tooltip.close();
    },
    onFocus: (event: FocusEvent<HTMLButtonElement>) => {
      onFocus?.(event);
      if (!pressing.current) tooltip.openNow();
    },
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      onBlur?.(event);
      tooltip.close();
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      tooltip.close();
    },
  };

  return asChild ? <Slot {...props} {...shared} /> : <button type="button" {...props} {...shared} />;
}

export interface TooltipContentProps extends ComponentProps<"div"> {
  side?: Side;
  align?: Align;
  /** Between the trigger and the arrow's tip, in pixels. */
  sideOffset?: number;
}

export function TooltipContent({
  side = "top",
  align = "center",
  sideOffset = 4,
  className,
  children,
  onPointerEnter,
  onPointerLeave,
  ...props
}: TooltipContentProps) {
  const tooltip = useTooltip();
  const ref = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const arrow = arrowRef.current;
    const trigger = tooltip.triggerRef.current;
    if (!tooltip.open || node === null || arrow === null || trigger === null) return;

    const anchor = trigger.getBoundingClientRect();
    const placement = place(
      anchor,
      measure(node),
      { width: window.innerWidth, height: window.innerHeight },
      // The arrow sits in the gap, so the note stands off by its height as well.
      { side, align, offset: sideOffset + arrow.offsetHeight },
    );
    const left = snap(placement.left);
    node.style.left = `${left}px`;
    node.style.top = `${snap(placement.top)}px`;
    node.dataset.side = placement.side;
    node.dataset.placed = "";

    // The arrow points at the middle of the trigger, never past the note's ends.
    const centre = anchor.left + anchor.width / 2 - left - arrow.offsetWidth / 2;
    arrow.style.left = `${Math.max(0, Math.min(centre, node.offsetWidth - arrow.offsetWidth))}px`;
  }, [tooltip.open, tooltip.triggerRef, side, align, sideOffset]);

  useLayer(tooltip.open, { node: () => ref.current, onEscape: tooltip.close });

  if (!tooltip.open) return null;

  return createPortal(
    <div
      ref={ref}
      id={tooltip.contentId}
      role="tooltip"
      data-state="open"
      className={cx("ui-tooltip", className)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        tooltip.keepOpen();
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        tooltip.close();
      }}
      {...props}
    >
      {children}
      <span ref={arrowRef} className="ui-tooltip-arrow" aria-hidden="true" />
    </div>,
    document.body,
  );
}
