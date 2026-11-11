"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as external state.
 *
 * The server render and the hydration render both answer `serverValue`, so
 * they cannot disagree; the real answer takes over on the first client commit.
 * The layout is desktop-first, so callers pass the wide-viewport answer.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return serverValue;
    return window.matchMedia(query).matches;
  }, [query, serverValue]);

  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

/**
 * Which side panels overlay the content instead of sitting beside it. The
 * rail needs 768px and the roster 1200px, the same breakpoints the style
 * sheets use.
 */
export function useLayoutMode(): {
  railOverlay: boolean;
  rosterOverlay: boolean;
} {
  const wide = useMediaQuery("(min-width: 768px)", true);
  const extraWide = useMediaQuery("(min-width: 1200px)", true);
  return { railOverlay: !wide, rosterOverlay: !extraWide };
}
