"use client";

import { useRef, type ReactNode, type Ref } from "react";

import { useLayer } from "@stellarr/ui/behavior";

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
 * Escape. While open it is a layer on the shared stack, so it answers only when
 * no layer above it does.
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

  useLayer(open, {
    node: () => panelRef.current,
    // The trigger toggles itself; closing on a press there too would reopen the
    // panel.
    owns: (target) =>
      panelRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true,
    onEscape: () => {
      onOpenChange(false);
      triggerRef.current?.focus();
    },
    onPointerDownOutside: () => {
      onOpenChange(false);
    },
  });

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
