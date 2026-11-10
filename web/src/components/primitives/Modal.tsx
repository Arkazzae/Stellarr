"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
 * While open it traps Tab, closes on Escape or a click on the backdrop, locks
 * page scrolling, and hands focus back to whatever had it before.
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Keeps a window-level Escape handler from also acting on this press.
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab" && wrapRef.current !== null) {
        trapTab(event, wrapRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      ref={wrapRef}
      className={entered ? `${className} open` : className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
