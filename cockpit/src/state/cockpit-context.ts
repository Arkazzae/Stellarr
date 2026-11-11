import { createContext, useContext } from "react";

import type { CockpitBootstrap } from "@/lib/api";

export type CockpitPhase = "loading" | "anonymous" | "forbidden" | "ready" | "error";

export interface CockpitContextValue {
  phase: CockpitPhase;
  bootstrap: CockpitBootstrap | null;
  error: string | null;
  /** Refreshes the bootstrap. Keeps the current screen when already ready. */
  reload: () => Promise<void>;
  /** Rejects when the credentials are refused, leaving the phase unchanged. */
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const CockpitContext = createContext<CockpitContextValue | null>(null);

export function useCockpit(): CockpitContextValue {
  const context = useContext(CockpitContext);
  if (!context) throw new Error("useCockpit must be used inside CockpitProvider");
  return context;
}
