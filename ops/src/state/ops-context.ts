import { createContext, useContext } from "react";

import type { OpsBootstrap } from "@/lib/api";

export type OpsPhase = "loading" | "anonymous" | "forbidden" | "ready" | "error";

export interface OpsContextValue {
  phase: OpsPhase;
  bootstrap: OpsBootstrap | null;
  error: string | null;
  /** Refreshes the bootstrap. Keeps the current screen when already ready. */
  reload: () => Promise<void>;
  /** Rejects when the credentials are refused, leaving the phase unchanged. */
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const OpsContext = createContext<OpsContextValue | null>(null);

export function useOps(): OpsContextValue {
  const context = useContext(OpsContext);
  if (!context) throw new Error("useOps must be used inside OpsProvider");
  return context;
}
