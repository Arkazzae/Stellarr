"use client";

import { useEffect } from "react";

import { removeLegacyPwaArtifacts } from "@/lib/pwa/cleanup";

/** Renders nothing; on mount it removes what PWA-era web releases left behind. */
export function LegacyPwaCleanup() {
  useEffect(() => {
    // Cleanup is best effort: a browser that refuses it must not break the app.
    removeLegacyPwaArtifacts().catch(() => undefined);
  }, []);
  return null;
}
