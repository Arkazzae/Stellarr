"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useLayer } from "@stellarr/ui/behavior";

import { focusWithin, trapTab } from "./focus";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Id of the element that names the dialog. */
  labelledBy: string;
  /** The wrapper class that styles the dialog, such as `sv-wrap` or `act-modal`. */
  className: string;
  /**
   * How long the wrapper stays mounted after closing, in milliseconds, so its
   * closing transition can run. Wrappers that only flip `display` leave at once.
   */
  exitMs?: number;
  children: ReactNode;
}

/**
 * The shared shell of the app's dialogs.
 *
 * The dialog mounts on demand: one that stays mounted while hidden keeps its
 * whole contents in the tab order and the accessibility tree. The wrapper's
 * `open` class still lands one frame after mount and leaves as soon as `open`
 * turns false, so the enter and exit transitions have a state to move from.
 *
 * While open it is a layer on the shared stack: it traps Tab, closes on Escape
 * or a click on the backdrop when no layer above it took that key or press,
 * locks page scrolling, and hands focus back to whatever had it before.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  className,
  exitMs = 0,
  children,
}: ModalProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const backdropPress = useRef<Event | null>(null);
  const backdropArmed = useRef(false);
  const [entered, setEntered] = useState(false);
  const [lingering, setLingering] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Derived from props during render rather than in an effect, so the commit
  // that closes the dialog already drops `open` and the exit transition starts
  // on the next paint, and a reopen during the exit starts over from closed.
  if (wasOpen !== open) {
    setWasOpen(open);
    setEntered(false);
    setLingering(!open && exitMs > 0);
  }
  const mounted = open || lingering;

  useEffect(() => {
    if (!lingering) return;
    const timer = window.setTimeout(() => setLingering(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [lingering, exitMs]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    focusWithin(wrapRef.current);
    return () => {
      // If the opener left the page, focus stays on <body> rather than jumping
      // somewhere arbitrary.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [mounted]);

  // The wrapper is its own backdrop, and a backdrop closes on the click, not on
  // the press: a touch that closed on the press would let the click that follows
  // land on whatever lies beneath. But a press on the backdrop may belong to a
  // layer above (a menu raised from the dialog), and only the stack knows which
  // layer a press belongs to. So the stack hands this layer the presses that are
  // its own, and the click closes only when it ends one of them.
  useLayer(open, {
    node: () => wrapRef.current,
    owns: (target) => {
      const wrapper = wrapRef.current;
      return wrapper !== null && target !== wrapper && wrapper.contains(target);
    },
    onEscape: () => {
      onClose();
    },
    onTab: (event) => {
      if (wrapRef.current !== null) trapTab(event, wrapRef.current);
    },
    onPointerDownOutside: (event) => {
      backdropPress.current = event;
    },
  });

  if (!mounted) return null;

  return (
    <div
      ref={wrapRef}
      className={entered ? `${className} open` : className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onPointerDown={(event) => {
        backdropArmed.current = event.nativeEvent === backdropPress.current;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropArmed.current) onClose();
      }}
    >
      {children}
    </div>
  );
}
