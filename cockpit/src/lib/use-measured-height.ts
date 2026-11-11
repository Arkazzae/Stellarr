import { useEffect, useRef, useState } from "react";

/**
 * The height of the element `ref` points to, kept up to date as the layout
 * changes, so a chart drawn at a fixed pixel height can fill a tile instead,
 * and the root font size then, for sizes given in px at the default font size
 * (the panel scales rem with the window, see index.css). Until it is measured
 * (and where ResizeObserver is missing) the height is `fallback` and rem 16 px.
 */
export function useMeasuredHeight<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [measure, setMeasure] = useState({ height: fallback, remPx: 16 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setMeasure({ height: Math.floor(entry.contentRect.height), remPx });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, measure.height, measure.remPx] as const;
}
