import { FOCUSABLE } from "@stellarr/ui/behavior";

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
 * Call it from a keydown handler for the Tab key. The container itself is
 * focusable (`tabindex="-1"`) and counts as "before the first" stop, so
 * Shift+Tab from it lands on the last one.
 */
export function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  const stops = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    container.focus();
    return;
  }

  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
