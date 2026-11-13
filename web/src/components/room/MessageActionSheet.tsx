"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useLayer } from "@stellarr/ui/behavior";
import { Icon, type IconName } from "@stellarr/ui/icons";
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
 *
 * It is a layer on the shared stack: Escape and a press on the backdrop close
 * it when no layer above it takes them.
 */
export function MessageActionSheet({
  title,
  closeLabel,
  items,
  returnFocusTo,
  onClose,
}: MessageActionSheetProps) {
  const titleId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // The layer element is the backdrop around the sheet. A press on it, or
  // anywhere else outside it, dismisses; a press on the sheet or on anything
  // the sheet holds is inside.
  useLayer(true, {
    node: () => layer.current,
    owns: (target) => {
      const backdrop = layer.current;
      return backdrop !== null && target !== backdrop && backdrop.contains(target);
    },
    onEscape: (event) => {
      event.preventDefault();
      onClose();
    },
    onTab: (event) => {
      if (sheet.current !== null) trapTab(event, sheet.current);
    },
    onPointerDownOutside: () => {
      onClose();
    },
  });

  useEffect(() => {
    const { body } = document;
    const overflow = body.style.overflow;
    const returnTarget = returnFocusTo.current;
    body.style.overflow = "hidden";
    // One frame later, so the sheet is laid out before it takes focus.
    const frame = requestAnimationFrame(() => focusWithin(sheet.current));
    return () => {
      cancelAnimationFrame(frame);
      body.style.overflow = overflow;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [returnFocusTo]);

  return createPortal(
    <div ref={layer} className="msg-action-layer">
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
