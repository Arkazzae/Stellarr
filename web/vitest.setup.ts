import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

/**
 * jsdom has no `matchMedia`. This answers `min-width` and `max-width` queries
 * from `window.innerWidth`, so a test picks a breakpoint by setting the
 * viewport width before it renders. Any other query does not match.
 */
function matchesViewport(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)?.[1];
  if (min) return window.innerWidth >= Number(min);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query)?.[1];
  if (max) return window.innerWidth <= Number(max);
  return false;
}

window.matchMedia = ((query: string) => ({
  get matches() {
    return matchesViewport(query);
  },
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// jsdom defines `play` but it throws "Not implemented", which would drown real
// failures in logged errors, so it is replaced rather than only filled in.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = (() =>
    Promise.resolve()) as HTMLMediaElement["play"];
}

// jsdom computes no layout, so it cannot scroll. Code that keeps a keyboard
// cursor visible still calls these.
Element.prototype.scrollTo ??= vi.fn() as unknown as Element["scrollTo"];
Element.prototype.scrollIntoView ??=
  vi.fn() as unknown as Element["scrollIntoView"];

// On an opaque origin `localStorage` is absent rather than empty. An in-memory
// map is enough, since code under test only reads back what it wrote.
if (typeof globalThis.localStorage === "undefined") {
  const entries = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
  });
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:stellarr-test");
  URL.revokeObjectURL = vi.fn();
}
