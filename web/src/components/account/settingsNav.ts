/**
 * Scrolls the settings tab bar just far enough to bring `item` fully into view.
 *
 * The offset is rounded away from the current position, so a fractional
 * layout never leaves a pixel of the tab clipped.
 */
export function revealSettingsNavItem(
  container: HTMLElement,
  item: HTMLElement,
): void {
  const view = container.getBoundingClientRect();
  const tab = item.getBoundingClientRect();

  let delta = 0;
  if (tab.left < view.left) delta = tab.left - view.left;
  else if (tab.right > view.right) delta = tab.right - view.right;
  if (delta === 0) return;

  const target = container.scrollLeft + delta;
  container.scrollTo?.({
    left: delta < 0 ? Math.floor(target) : Math.ceil(target),
    behavior: "auto",
  });
}
