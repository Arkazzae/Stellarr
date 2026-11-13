import { useEffect, useRef } from "react";

/**
 * Everything that floats over the page (a dialog, a sheet, a menu, a tooltip)
 * is a layer. Only the topmost layer that handles a key hears it, so Escape in
 * a menu opened from a sheet closes the menu and leaves the sheet open.
 */
export interface Layer {
  /** The layer's own element; a press inside it is not "outside". */
  node: () => HTMLElement | null;
  onEscape?: (event: KeyboardEvent) => void;
  onTab?: (event: KeyboardEvent) => void;
  /** A press anywhere else; only the topmost layer hears it. */
  onPointerDownOutside?: (event: PointerEvent) => void;
}

const stack: Layer[] = [];

function topmost(handles: keyof Layer): Layer | undefined {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const layer = stack[i];
    if (layer?.[handles] !== undefined) return layer;
  }
  return undefined;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    const layer = topmost("onEscape");
    if (layer === undefined) return;
    // A window-level Escape handler must not also act on this press.
    event.stopPropagation();
    layer.onEscape?.(event);
  } else if (event.key === "Tab") {
    topmost("onTab")?.onTab?.(event);
  }
}

function onPointerDown(event: PointerEvent) {
  const layer = stack[stack.length - 1];
  const node = layer?.node();
  if (layer === undefined || node === null || node === undefined) return;
  if (event.target instanceof Node && node.contains(event.target)) return;
  layer.onPointerDownOutside?.(event);
}

function push(layer: Layer): () => void {
  stack.push(layer);
  if (stack.length === 1) {
    // Capture, so the layer hears the key before anything inside the page does.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
  }
  return () => {
    const index = stack.lastIndexOf(layer);
    if (index !== -1) stack.splice(index, 1);
    if (stack.length === 0) {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    }
  };
}

/** Puts a layer on the stack while `active`; the handlers may change between renders. */
export function useLayer(active: boolean, layer: Layer): void {
  const latest = useRef(layer);
  useEffect(() => {
    latest.current = layer;
  });

  useEffect(() => {
    if (!active) return;
    return push({
      node: () => latest.current.node(),
      onEscape: layer.onEscape && ((event) => latest.current.onEscape?.(event)),
      onTab: layer.onTab && ((event) => latest.current.onTab?.(event)),
      onPointerDownOutside:
        layer.onPointerDownOutside && ((event) => latest.current.onPointerDownOutside?.(event)),
    });
    // Which handlers exist is fixed for a layer; their bodies come from `latest`.
  }, [active]);
}

/* -------------------------------------------------------------------------- */

const hiddenBy = new Map<Element, number>();

/**
 * Hides everything beside `keep` from assistive tech while a modal layer is
 * open, as the dialog semantics promise. Counted per element, so a menu opened
 * from a sheet does not unhide the page when it closes.
 */
export function hideOthers(keep: Array<Element | null>): () => void {
  const kept = keep.filter((node): node is Element => node !== null);
  const hidden: Element[] = [];
  for (const child of Array.from(document.body.children)) {
    if (kept.some((node) => child === node || child.contains(node))) continue;
    if (child.matches("script,style,template,[aria-live]")) continue;
    const count = hiddenBy.get(child) ?? 0;
    if (count === 0 && child.getAttribute("aria-hidden") === "true") continue;
    if (count === 0) child.setAttribute("aria-hidden", "true");
    hiddenBy.set(child, count + 1);
    hidden.push(child);
  }
  return () => {
    for (const child of hidden) {
      const count = (hiddenBy.get(child) ?? 1) - 1;
      if (count > 0) {
        hiddenBy.set(child, count);
      } else {
        hiddenBy.delete(child);
        child.removeAttribute("aria-hidden");
      }
    }
  };
}

/* -------------------------------------------------------------------------- */

let locks = 0;
let previousOverflow = "";
const scrollAreas: Array<() => Element[]> = [];

function blockScroll(event: Event) {
  const allowed = scrollAreas.flatMap((areas) => areas());
  if (event.target instanceof Node && allowed.some((area) => area.contains(event.target as Node))) return;
  event.preventDefault();
}

/**
 * Stops the page from scrolling under a modal layer, except inside the
 * layer's own elements, and returns the undo.
 */
export function lockScroll(areas: () => Element[]): () => void {
  scrollAreas.push(areas);
  locks += 1;
  if (locks === 1) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("wheel", blockScroll, { passive: false });
    document.addEventListener("touchmove", blockScroll, { passive: false });
  }
  return () => {
    scrollAreas.splice(scrollAreas.indexOf(areas), 1);
    locks -= 1;
    if (locks === 0) {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("wheel", blockScroll);
      document.removeEventListener("touchmove", blockScroll);
    }
  };
}

let pointerLocks = 0;
let previousPointerEvents = "";

/**
 * Makes the page ignore the pointer while a menu is open, so a press beside
 * the menu only closes it and does not also land on whatever is underneath.
 */
export function lockPointer(): () => void {
  pointerLocks += 1;
  if (pointerLocks === 1) {
    previousPointerEvents = document.body.style.pointerEvents;
    document.body.style.pointerEvents = "none";
  }
  return () => {
    pointerLocks -= 1;
    if (pointerLocks === 0) document.body.style.pointerEvents = previousPointerEvents;
  };
}
