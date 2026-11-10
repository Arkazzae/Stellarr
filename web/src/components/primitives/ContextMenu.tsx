"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "@/components/icons/Icon";

/** The least room the menu leaves to the edge of the viewport. */
const MARGIN = 8;

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Drawn red, and kept last in its group. */
  danger?: boolean;
  onSelect: () => void;
}

/** A rule between groups. Rules at an edge or doubled up are dropped. */
export type MenuEntry = MenuItem | "separator";

export interface ContextMenuProps {
  /** Where the pointer was, in viewport coordinates. */
  at: { x: number; y: number };
  entries: MenuEntry[];
  /** Names the menu for assistive tech: "Message", "Maja". */
  label: string;
  /**
   * A local control that belongs to what is under the pointer, shown before the
   * action list. Unlike an item it stays open while it is operated.
   */
  controls?: ReactNode;
  onClose: () => void;
}

function isItem(entry: MenuEntry): entry is MenuItem {
  return entry !== "separator";
}

/**
 * Drops the rules a permission filter leaves behind: one first, one last, or
 * one right after another rule. Positions are those of the list as given, so
 * when several rules end it the first of them stays.
 */
function withoutStraySeparators(entries: MenuEntry[]): MenuEntry[] {
  return entries.filter((entry, index) => {
    if (isItem(entry)) return true;
    const previous = entries[index - 1];
    return index < entries.length - 1 && previous !== undefined && isItem(previous);
  });
}

/**
 * The right-click menu.
 *
 * It opens at the pointer, where the hand already is, and flips against
 * whichever viewport edge it would cross, so a menu raised at the bottom of the
 * transcript opens upwards instead of off-screen.
 *
 * It renders into `document.body`: the transcript transforms its rows, and a
 * transformed ancestor makes `position: fixed` resolve against that ancestor
 * instead of the viewport, which would clip the menu by the row it came from.
 *
 * Keep it short. Past about six items a menu stops being faster than the
 * alternative and becomes something to read.
 */
export function ContextMenu({ at, entries, label, controls, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const [cursor, setCursor] = useState(0);

  const actions = withoutStraySeparators(entries);
  const items = actions.filter(isItem);
  const hasControls = controls !== undefined;

  // Placed before paint: the size is not known until the menu exists, and a
  // frame at the raw pointer position would be a visible jump.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const { width, height } = menu.getBoundingClientRect();
    setPlaced({
      left: at.x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, at.x - width) : at.x,
      top: at.y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, at.y - height) : at.y,
    });
  }, [at.x, at.y]);

  useEffect(() => {
    // Focus lands as soon as the menu exists: it is the only thing that answers
    // the arrow keys while open, and a gap before it does is a gap someone types
    // into. With controls, the first control gets it.
    const menu = menuRef.current;
    const firstControl = hasControls
      ? menu?.querySelector<HTMLElement>("input, select, textarea, button")
      : null;
    (firstControl ?? menu)?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      onClose();
    };
    // Scrolling or resizing moves what the menu was opened on out from under
    // it, and a menu pointing at nothing is worse than none.
    const onLeave = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onLeave, true);
    window.addEventListener("resize", onLeave);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onLeave, true);
      window.removeEventListener("resize", onLeave);
    };
  }, [hasControls, onClose]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLElement>(".ctx-item[data-on]")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = (item: MenuItem) => {
    onClose();
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    // A range needs the arrows and a text field needs Space and Enter: those
    // controls keep their native keys instead of steering the action list.
    const { target } = event;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (items.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps: a menu this short has no far end worth stopping at.
      setCursor((current) => (current + step + items.length) % items.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[cursor];
      if (item !== undefined) run(item);
    }
  };

  const list = actions.map((entry, index) => {
    if (entry === "separator") {
      return <div key={`separator-${index}`} className="ctx-sep" role="separator" />;
    }
    const position = items.indexOf(entry);
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        className={entry.danger === true ? "ctx-item danger" : "ctx-item"}
        data-on={position === cursor ? "" : undefined}
        onMouseEnter={() => setCursor(position)}
        onClick={() => run(entry)}
      >
        {entry.icon === undefined ? null : (
          <span className="ctx-ico" aria-hidden="true">
            <Icon name={entry.icon} size={15} />
          </span>
        )}
        {entry.label}
      </button>
    );
  });

  // Without controls the menu is the list. With them the list moves into a menu
  // of its own beneath the controls, and a menu of only controls is a dialog.
  const role = !hasControls ? "menu" : items.length === 0 ? "dialog" : undefined;
  let body: ReactNode = list;
  if (hasControls) {
    body =
      items.length === 0 ? (
        controls
      ) : (
        <>
          {controls}
          <div className="ctx-sep" role="separator" />
          <div role="menu" aria-label={label}>
            {list}
          </div>
        </>
      );
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ctx"
      role={role}
      aria-label={role === undefined ? undefined : label}
      tabIndex={-1}
      style={
        {
          "--ctx-left": `${placed?.left ?? at.x}px`,
          "--ctx-top": `${placed?.top ?? at.y}px`,
          // Hidden until placed rather than drawn at the pointer and corrected:
          // the correction is what would be seen.
          visibility: placed === null ? "hidden" : "visible",
        } as CSSProperties
      }
      onKeyDown={onKeyDown}
    >
      {body}
    </div>,
    document.body,
  );
}

/**
 * Right-click state for one surface.
 *
 * Returns the point to open at and the handler for `onContextMenu`. The
 * awkward part, suppressing the browser's own menu only when there is
 * something to replace it with, is the same everywhere.
 */
export function useContextMenu() {
  const [open, setOpen] = useState<{
    x: number;
    y: number;
    /**
     * What the menu was raised from. Captured with the event, not read off a
     * ref when an item runs: a profile card opened from the menu hangs off the
     * row, and the row is a fact about the event, not about whichever render is
     * current when someone finally clicks.
     */
    anchor: HTMLElement;
  } | null>(null);

  const openAt = useCallback((anchor: HTMLElement, x: number, y: number) => {
    setOpen({ x, y, anchor });
  }, []);

  return {
    at: open === null ? null : { x: open.x, y: open.y },
    anchor: open?.anchor ?? null,
    close: () => setOpen(null),
    /** Opens from a real control where right-click is not available, such as touch. */
    openAt,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      // Shift+right-click reaches the browser's own menu, which is how someone
      // gets "Save image" on something this menu was drawn over.
      if (event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      openAt(event.currentTarget, event.clientX, event.clientY);
    },
  };
}
