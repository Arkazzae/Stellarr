"use client";

import { useEffect } from "react";

/**
 * Targets where the browser's own context menu is worth more than silence:
 * fields (paste, undo, spelling), links, and media (save as). Anything else
 * would only offer document-level entries such as "Back" or "View source",
 * which are noise in an application.
 */
const NATIVE_MENU_TARGETS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]",
  "a[href]",
  "img",
  "video",
  "audio",
  // Opt-in for a surface that wants the browser's menu without being one of
  // the elements above.
  "[data-native-menu]",
].join(",");

/**
 * Whether the pointer is inside a non-empty selection. A selection elsewhere
 * on the page says nothing about what is under the pointer now.
 */
function pointerIsInSelection(target: Node): boolean {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(target)) return true;
  }
  return false;
}

/**
 * The allow-list: true when a right-click should reach the browser's menu.
 *
 * Shift is the escape hatch `useContextMenu` already documents, and an event
 * that is already default-prevented belongs to one of the app's own menus.
 */
export function shouldKeepNativeMenu(event: MouseEvent): boolean {
  if (event.shiftKey || event.defaultPrevented) return true;
  const { target } = event;
  if (!(target instanceof Element)) return true;
  return target.closest(NATIVE_MENU_TARGETS) !== null || pointerIsInSelection(target);
}

/**
 * Suppresses the browser's context menu everywhere except where
 * `shouldKeepNativeMenu` allows it.
 *
 * One bubble-phase listener on `document` rather than a handler per surface,
 * so a new component cannot forget the rule, and any surface with its own menu
 * has already handled the event by the time it arrives here.
 */
export function useContextMenuPolicy(): void {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (!shouldKeepNativeMenu(event)) event.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
}
