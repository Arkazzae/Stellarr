"use client";

import { useEffect, useState } from "react";

import { readGiphyConfig } from "@/lib/giphy";

/**
 * Whether to offer GIFs, as Stellarr's API says; false until it has answered.
 * When the API cannot be asked, a key bundled into the build keeps them on.
 */
export function useGifsEnabled(bundledKey: string): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let live = true;
    readGiphyConfig().then(
      (config) => {
        if (live) setEnabled(config.enabled);
      },
      () => {
        if (live) setEnabled(bundledKey.trim() !== "");
      },
    );
    return () => {
      live = false;
    };
  }, [bundledKey]);

  return enabled;
}
