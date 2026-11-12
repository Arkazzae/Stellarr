import { useEffect, useRef, useState } from "react";

export interface MeasuredBox {
  width: number;
  height: number;
  /** The root font size over 16 px: sizes given in px at the default font size are multiplied by it (see index.css). */
  scale: number;
}

/**
 * The size of the element `ref` points to, kept up to date as the layout
 * changes, for a chart that draws round dots and arcs in real pixels instead
 * of on a stretched canvas. Until it is measured (and where ResizeObserver is
 * missing) the box is empty, so such a chart draws nothing yet.
 */
export function useMeasuredBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<MeasuredBox>({ width: 0, height: 0, scale: 1 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height, scale: remPx / 16 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, box] as const;
}
