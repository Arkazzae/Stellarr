import { FOCUSABLE, trapTab as sharedTrapTab } from "@stellarr/ui/behavior";

/**
 * What counts as a tab stop inside a dialog or an anchored card. It is the
 * shared package's list, so its overlays and the ones here agree on where Tab
 * goes; a disabled control is not on it, or a trap would strand the keyboard
 * on a pane that is unsupported and disables its controls.
 */
export { FOCUSABLE };

/** Focuses the first tab stop in `container`, or the container when it has none. */
export function focusWithin(container: HTMLElement | null): void {
  (container?.querySelector<HTMLElement>(FOCUSABLE) ?? container)?.focus();
}

/**
 * Keeps a Tab press inside `container` by wrapping at both ends.
 *
 * Call it from a layer's `onTab`. The container itself is focusable
 * (`tabindex="-1"`) and counts as "before the first" stop, so Shift+Tab from it
 * lands on the last one.
 *
 * Unlike the shared package's trap, it does not pull the focus back in when it
 * is outside the container: an anchored card or a menu may sit above a dialog,
 * outside its element, and hold the focus, so a Tab from there is left alone.
 */
export function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  sharedTrapTab(event, container, { reclaim: false });
}
