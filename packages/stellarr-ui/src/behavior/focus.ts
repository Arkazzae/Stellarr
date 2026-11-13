/**
 * What counts as a tab stop inside a dialog or a menu.
 *
 * `:not([disabled])` matters: a trap that stopped on a disabled control would
 * strand the keyboard. The same list as the web client's dialogs. It is a
 * selector for `querySelectorAll` and `matches`.
 */
export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function tabStops(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Focuses the first tab stop in `container` that is not a link, or the
 * container when there is none. A link is skipped because Enter on it leaves
 * the dialog; a field is selected so typing replaces what it holds.
 *
 * Give the container `tabindex="-1"`, or it cannot take the focus when it has
 * no stop. Call it once the container is in the document, as a layer opens.
 */
export function focusFirst(container: HTMLElement | null): void {
  if (container === null) return;
  const first = tabStops(container).find((stop) => !stop.matches("a[href]"));
  const target = first ?? container;
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement) target.select();
}

/**
 * Keeps a Tab press inside `container` by wrapping at both ends.
 *
 * The container itself is focusable (`tabindex="-1"`) and counts as "before
 * the first" stop, so Shift+Tab from it lands on the last one.
 *
 * Call it from a Tab key handler, such as a layer's `onTab`. It calls
 * `preventDefault()` only when it moves the focus itself; a Tab in the middle
 * of the container is left to the browser.
 *
 * A Tab pressed while the focus is outside the container brings it back to the
 * first stop, as a modal layer wants. Pass `reclaim: false` for a layer beside
 * which the page still works, such as a side panel: the Tab is then left to
 * the browser, and only the ends and a container without stops are handled.
 */
export function trapTab(
  event: KeyboardEvent,
  container: HTMLElement,
  options: { reclaim?: boolean } = {},
): void {
  const { reclaim = true } = options;
  const stops = tabStops(container);
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
  } else if (!event.shiftKey && (active === last || (reclaim && !container.contains(active)))) {
    event.preventDefault();
    first.focus();
  }
}
