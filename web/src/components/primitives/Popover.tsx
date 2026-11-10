"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  "aria-haspopup": true;
  "aria-expanded": boolean;
  onClick: () => void;
}

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Spread the given props onto the trigger button so the wiring cannot drift. */
  renderTrigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  /** Extra classes on the panel, such as `board` or `vc-menu`. */
  className?: string;
}

/**
 * A panel that hangs off a dock or a row and closes on a click elsewhere or on
 * Escape.
 *
 * Trigger and panel render as siblings. The panel is positioned by CSS against
 * the region that contains the pair, so it lands in the same place wherever
 * inside that region the trigger sits, and the trigger's `aria-expanded` can
 * never disagree with the panel's `hidden`.
 */
export function Popover({
  open,
  onOpenChange,
  renderTrigger,
  children,
  className,
}: PopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      // The trigger toggles itself; closing here too would reopen the panel.
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The shell listens on `window`, one hop further along. Stopping here
      // closes the popover without also closing the drawer behind it.
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <>
      {renderTrigger({
        ref: triggerRef,
        "aria-haspopup": true,
        "aria-expanded": open,
        onClick: () => onOpenChange(!open),
      })}
      <div
        ref={panelRef}
        className={className ? `dock-pop ${className}` : "dock-pop"}
        hidden={!open}
      >
        {children}
      </div>
    </>
  );
}
