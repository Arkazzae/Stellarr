import { createContext, useContext } from "react";

import type { CockpitBootstrap } from "@/lib/api";

/** `mfa-required`: the owner is signed in, but the session has not completed the second step Cockpit asks for. */
export type CockpitPhase = "loading" | "anonymous" | "forbidden" | "mfa-required" | "ready" | "error";

export interface CockpitContextValue {
  phase: CockpitPhase;
  bootstrap: CockpitBootstrap | null;
  error: string | null;
  /** Refreshes the bootstrap. Keeps the current screen when already ready. */
  reload: () => Promise<void>;
  /**
   * Rejects when the credentials are refused, leaving the phase unchanged.
   * When the password is not enough, leaves for the web client's sign-in page
   * to finish the step there.
   */
  login: (username: string, password: string, keepSignedIn?: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

export const CockpitContext = createContext<CockpitContextValue | null>(null);

export function useCockpit(): CockpitContextValue {
  const context = useContext(CockpitContext);
  if (!context) throw new Error("useCockpit must be used inside CockpitProvider");
  return context;
}
