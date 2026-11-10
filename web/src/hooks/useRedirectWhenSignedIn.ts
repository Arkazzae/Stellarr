"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { takePendingInvite } from "@/lib/invites";
import type { SessionPhase } from "@/state/hooks";

/**
 * Leaves the sign-in and registration pages once a session works: for the
 * invite the visitor came with if there is one, otherwise for the home page.
 *
 * It reacts to the phase the session provider already computed, so a fresh
 * sign-in and an already-valid session take the same path and no second
 * request is made.
 */
export function useRedirectWhenSignedIn(phase: SessionPhase): void {
  const router = useRouter();

  useEffect(() => {
    if (phase !== "ready") return;
    const invite = takePendingInvite();
    router.replace(invite === null ? "/" : `/invite/${encodeURIComponent(invite)}`);
  }, [phase, router]);
}
