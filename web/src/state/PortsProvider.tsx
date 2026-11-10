"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { getRuntime, type Runtime } from "@/adapters";
import type { Ports } from "@/ports";

/**
 * The composition root, handed to React.
 *
 * The whole runtime is published rather than just `ports`, because the session
 * owns two things that are not ports: seeding the stores from the boot payload
 * and starting or stopping the socket. Everything else calls `usePorts()` and
 * never learns that those two exist.
 */
const RuntimeContext = createContext<Runtime | null>(null);

export interface PortsProviderProps {
  children: ReactNode;
  /** A test double. Without one, the real runtime is built once per browser. */
  runtime?: Runtime;
}

export function PortsProvider({ children, runtime }: PortsProviderProps) {
  // Building the runtime during render is safe: adapter constructors do no
  // work until a port is called, and `getRuntime` caches the result.
  const value = useMemo(() => runtime ?? getRuntime(), [runtime]);

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("useRuntime must be used inside <PortsProvider>");
  }
  return runtime;
}

export function usePorts(): Ports {
  return useRuntime().ports;
}
