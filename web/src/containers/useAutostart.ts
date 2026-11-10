"use client";

import { useCallback, useEffect, useState } from "react";

import type { DesktopPort } from "@/ports";

export interface Autostart {
  /** False in a browser, and on a desktop build that cannot register itself. */
  available: boolean;
  enabled: boolean;
  /** A read or a write is outstanding; the switch ignores further changes. */
  pending: boolean;
  /** The last read or write failed. */
  error: boolean;
}

/**
 * Whether the desktop client starts with the operating system.
 *
 * The setting lives in the operating system, so it is read from the port when
 * the dialog's container mounts and written through it. A change shows at once
 * and is taken back if the system refuses it, so the switch never claims
 * something the machine did not do.
 */
export function useAutostart(desktop: DesktopPort | undefined): {
  autostart: Autostart;
  setEnabled: (enabled: boolean) => void;
} {
  const [autostart, setAutostart] = useState<Autostart>({
    available: desktop !== undefined,
    enabled: false,
    pending: desktop !== undefined,
    error: false,
  });

  useEffect(() => {
    if (desktop === undefined) return;
    let current = true;
    desktop.getAutostart().then(
      (status) => {
        if (current) setAutostart({ ...status, pending: false, error: false });
      },
      (cause: unknown) => {
        console.error("Could not read the autostart setting.", cause);
        if (current) setAutostart((was) => ({ ...was, pending: false, error: true }));
      },
    );
    return () => {
      current = false;
    };
  }, [desktop]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (desktop === undefined || autostart.pending) return;
      const previous = autostart.enabled;
      setAutostart((was) => ({ ...was, enabled, pending: true, error: false }));
      desktop.setAutostart(enabled).then(
        (status) => setAutostart({ ...status, pending: false, error: false }),
        (cause: unknown) => {
          console.error("Could not change the autostart setting.", cause);
          setAutostart((was) => ({
            ...was,
            enabled: previous,
            pending: false,
            error: true,
          }));
        },
      );
    },
    [autostart.enabled, autostart.pending, desktop],
  );

  return { autostart, setEnabled };
}
