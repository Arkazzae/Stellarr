"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { takePendingInvite } from "@/lib/invites";
import type { SessionPhase } from "@/state/hooks";

/**
 * Leaves the sign-in and registration pages once a session works: for the
 * checked return path when the sign-in started elsewhere, such as Cockpit,
 * then for the invite the visitor came with, otherwise for the home page.
 *
 * It reacts to the phase the session provider already computed, so a fresh
 * sign-in and an already-valid session take the same path and no second
 * request is made.
 */
export function useRedirectWhenSignedIn(phase: SessionPhase, returnPath: string | null = null): void {
  const router = useRouter();

  useEffect(() => {
    if (phase !== "ready") return;
    if (returnPath !== null) {
      // Cockpit and the desktop confirmation live outside this app's router,
      // so the way back is a full navigation. The path was checked by
      // `safeReturnPath` and cannot leave the origin.
      window.location.replace(returnPath);
      return;
    }
    const invite = takePendingInvite();
    router.replace(invite === null ? "/" : `/invite/${encodeURIComponent(invite)}`);
  }, [phase, router, returnPath]);
}
