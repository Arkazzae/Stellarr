"use client";

import { useCallback, useState } from "react";

export interface AsyncAction {
  /** True from the moment an operation starts until it settles. */
  pending: boolean;
  /** True when the last operation threw; cleared when the next one starts. */
  failed: boolean;
  /** Runs the operation and resolves to whether it completed without throwing. */
  run: (operation: () => Promise<unknown>) => Promise<boolean>;
}

/**
 * The pending and failed state of a button that calls the server.
 *
 * The management panes disable their controls while a request is in flight and
 * show one line when it failed. `run` never rejects, so callers can fire it
 * from an event handler without a catch of their own.
 */
export function useAsyncAction(): AsyncAction {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setPending(true);
    setFailed(false);
    try {
      await operation();
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, failed, run };
}
