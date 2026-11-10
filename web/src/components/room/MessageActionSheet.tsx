"use client";

import { useEffect, useEffectEvent, useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "@/components/icons/Icon";
import { focusWithin, trapTab } from "@/components/primitives/focus";

export interface SheetItem {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  /** Present for a toggle, such as pin; absent for a plain action. */
  pressed?: boolean;
  onSelect(): void;
}

export interface MessageActionSheetProps {
  title: string;
  closeLabel: string;
  items: readonly SheetItem[];
  /** Takes focus back when the sheet closes, if it is still on the page. */
  returnFocusTo: RefObject<HTMLElement | null>;
  onClose(): void;
}

/**
 * The phone's version of the hover toolbar: every action with its name, in a
 * modal sheet. Selecting an item closes the sheet first, so an action that
 * opens something else of its own does so on a clear screen.
 */
export function MessageActionSheet({
  title,
  closeLabel,
  items,
  returnFocusTo,
  onClose,
}: MessageActionSheetProps) {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);

  const keyPressed = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab" && sheet.current !== null) {
      trapTab(event, sheet.current);
    }
  });

  useEffect(() => {
    const { body } = document;
    const overflow = body.style.overflow;
    const returnTarget = returnFocusTo.current;
    body.style.overflow = "hidden";
    // One frame later, so the sheet is laid out before it takes focus.
    const frame = requestAnimationFrame(() => focusWithin(sheet.current));
    document.addEventListener("keydown", keyPressed);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keyPressed);
      body.style.overflow = overflow;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [returnFocusTo]);

  return createPortal(
    <div
      className="msg-action-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="msg-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="msg-action-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="msg-action-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="msg-action-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.danger === true ? "msg-action-item danger" : "msg-action-item"}
              disabled={item.disabled}
              aria-pressed={item.pressed}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
