import { useEffect, useRef, useState } from "react";

/**
 * The height of the element `ref` points to, kept up to date as the layout
 * changes, so a chart drawn at a fixed pixel height can fill a tile instead.
 * Until it is measured (and where ResizeObserver is missing) it is `fallback`.
 */
export function useMeasuredHeight<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(Math.floor(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
}
