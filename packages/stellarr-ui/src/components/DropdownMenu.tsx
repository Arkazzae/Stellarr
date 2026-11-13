"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "../cx";
import { hideOthers, lockPointer, lockScroll, useLayer } from "../internal/layers";
import { measure, place, snap, type Align, type Side } from "../internal/place";
import { usePresence } from "../internal/presence";
import { useComposedRefs } from "../internal/refs";
import { Slot } from "../internal/slot";
import { useControllableState } from "../internal/state";

/** How long a typed prefix stays alive before the next key starts a new one. */
const TYPEAHEAD_MS = 1000;

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Closes the menu and hands focus back to the trigger, in the same step. */
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerId: string;
  contentId: string;
  /** Opened with the keyboard: the first item takes focus rather than the menu itself. */
  openedByKey: RefObject<boolean>;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu(): MenuContextValue {
  const context = useContext(MenuContext);
  if (context === null) throw new Error("DropdownMenu parts must sit inside <DropdownMenu>.");
  return context;
}

export interface DropdownMenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

/**
 * A list of actions that hangs off a button. While it is open the page ignores
 * the pointer and the keyboard stays in the list: the arrows, Home, End and
 * typing move between items, Enter or Space picks one, Escape closes.
 */
export function DropdownMenu({ open, defaultOpen = false, onOpenChange, children }: DropdownMenuProps) {
  const [current, setOpen] = useControllableState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openedByKey = useRef(false);
  const id = useId();

  const close = () => {
    setOpen(false);
    // Synchronously, so a dialog an item opens finds focus on the trigger and
    // returns it there when it closes.
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <MenuContext.Provider
      value={{
        open: current,
        setOpen,
        close,
        triggerRef,
        triggerId: `${id}-trigger`,
        contentId: `${id}-content`,
        openedByKey,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export interface DropdownMenuTriggerProps extends ComponentProps<"button"> {
  /** Gives the one child element, usually a Button, the trigger's behaviour. */
  asChild?: boolean;
}

export function DropdownMenuTrigger({ asChild, onClick, onKeyDown, ref, ...props }: DropdownMenuTriggerProps) {
  const menu = useMenu();
  const composedRef = useComposedRefs<HTMLButtonElement>(ref, menu.triggerRef);
  const shared = {
    ref: composedRef,
    id: menu.triggerId,
    "aria-haspopup": "menu" as const,
    "aria-expanded": menu.open,
    "aria-controls": menu.open ? menu.contentId : undefined,
    "data-state": menu.open ? "open" : "closed",
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      menu.openedByKey.current = false;
      menu.setOpen(!menu.open);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        // Also keeps Enter and Space from clicking the button and closing it again.
        event.preventDefault();
        menu.openedByKey.current = true;
        menu.setOpen(true);
      }
    },
  };
  return asChild ? <Slot {...props} {...shared} /> : <button type="button" {...props} {...shared} />;
}

const ITEM = '[role="menuitem"]:not([data-disabled])';

export interface DropdownMenuContentProps extends ComponentProps<"div"> {
  side?: Side;
  align?: Align;
  /** Between the trigger and the list, in pixels. */
  sideOffset?: number;
}

export function DropdownMenuContent({
  side = "bottom",
  align = "center",
  sideOffset = 4,
  className,
  style,
  onKeyDown,
  children,
  ...props
}: DropdownMenuContentProps) {
  const menu = useMenu();
  const { open } = menu;
  const { present, ref } = usePresence<HTMLDivElement>(open);
  const typed = useRef({ prefix: "", at: 0 });

  const reposition = useCallback(() => {
    const node = ref.current;
    const trigger = menu.triggerRef.current;
    if (node === null || trigger === null) return;
    const placement = place(
      trigger.getBoundingClientRect(),
      measure(node),
      { width: window.innerWidth, height: window.innerHeight },
      { side, align, offset: sideOffset },
    );
    // Written to the element rather than kept in state: the list is placed
    // and focused before the browser paints, never drawn in the corner first.
    node.style.left = `${snap(placement.left)}px`;
    node.style.top = `${snap(placement.top)}px`;
    node.style.setProperty("--ui-menu-available-height", `${placement.availableHeight}px`);
    node.dataset.side = placement.side;
    node.dataset.placed = "";
  }, [ref, menu.triggerRef, side, align, sideOffset]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const node = ref.current;
    if (menu.openedByKey.current) node?.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true });
    else node?.focus({ preventScroll: true });

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, { capture: true });
    };
  }, [open, reposition, ref, menu.openedByKey]);

  useEffect(() => {
    if (!open) return;
    const showOthers = hideOthers([ref.current]);
    const unlockScroll = lockScroll(() => (ref.current === null ? [] : [ref.current]));
    const unlockPointer = lockPointer();
    return () => {
      showOthers();
      unlockScroll();
      unlockPointer();
    };
  }, [open, ref]);

  useLayer(open, {
    node: () => ref.current,
    onEscape: () => menu.close(),
    // The list keeps the keyboard; Tab does not walk out of it.
    onTab: (event) => event.preventDefault(),
    onPointerDownOutside: () => menu.close(),
  });

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM));
    const at = items.findIndex((item) => item === document.activeElement);
    const last = items.length - 1;
    let to: number | null = null;
    if (event.key === "ArrowDown") to = at === -1 ? 0 : Math.min(at + 1, last);
    else if (event.key === "ArrowUp") to = at === -1 ? last : Math.max(at - 1, 0);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = last;
    else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Type to jump, from just after the current item, so a repeated letter walks on.
      const now = Date.now();
      const prefix = (now - typed.current.at > TYPEAHEAD_MS ? "" : typed.current.prefix) + event.key.toLowerCase();
      typed.current = { prefix, at: now };
      const hit = items
        .map((_, offset) => (at + 1 + offset) % items.length)
        .find((index) => items[index]?.textContent?.trim().toLowerCase().startsWith(prefix));
      if (hit !== undefined) to = hit;
    }
    if (to === null) return;
    event.preventDefault();
    items[to]?.focus({ preventScroll: true });
  };

  if (!present) return null;

  return createPortal(
    <div
      ref={ref}
      id={menu.contentId}
      role="menu"
      aria-orientation="vertical"
      aria-labelledby={menu.triggerId}
      tabIndex={-1}
      data-state={open ? "open" : "closed"}
      className={cx("ui-menu", className)}
      // The page ignores the pointer while the menu is open; the menu takes it
      // back, and gives it up again while it fades out.
      style={{ pointerEvents: open ? "auto" : "none", ...style }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) onListKeyDown(event);
      }}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface DropdownMenuItemProps extends Omit<ComponentProps<"div">, "onSelect"> {
  /** Gives the one child element, such as an `<a>`, the item's behaviour. */
  asChild?: boolean;
  /** `destructive` for an action that removes or ends something. */
  variant?: "default" | "destructive";
  disabled?: boolean;
  /** Runs when the item is picked; `preventDefault()` keeps the menu open. */
  onSelect?: (event: Event) => void;
}

export function DropdownMenuItem({
  asChild,
  variant = "default",
  disabled = false,
  onSelect,
  className,
  onClick,
  onKeyDown,
  onPointerMove,
  onPointerLeave,
  ...props
}: DropdownMenuItemProps) {
  const menu = useMenu();
  const backToList = (item: HTMLElement) => item.closest<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true });

  const shared = {
    role: "menuitem",
    tabIndex: -1,
    "aria-disabled": disabled ? true : undefined,
    "data-disabled": disabled ? "" : undefined,
    "data-variant": variant,
    className: cx("ui-menu-item", className),
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      onClick?.(event);
      if (disabled || event.defaultPrevented) return;
      const select = new Event("select", { cancelable: true });
      onSelect?.(select);
      if (!select.defaultPrevented) menu.close();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (disabled || event.defaultPrevented) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.currentTarget.click();
      }
    },
    // The pointer and the keyboard share one highlight: the item with focus.
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(event);
      if (event.pointerType !== "mouse") return;
      const item = event.currentTarget;
      if (disabled) backToList(item);
      else if (document.activeElement !== item) item.focus({ preventScroll: true });
    },
    onPointerLeave: (event: PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(event);
      if (event.pointerType === "mouse") backToList(event.currentTarget);
    },
  };

  return asChild ? <Slot {...props} {...shared} /> : <div {...props} {...shared} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-menu-label", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<"div">) {
  return <div role="separator" aria-orientation="horizontal" className={cx("ui-menu-separator", className)} {...props} />;
}
