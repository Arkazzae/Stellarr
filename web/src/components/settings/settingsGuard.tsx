"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Answers whether leaving must wait; when it must, it shows why. */
type Blocker = () => boolean;

export interface SettingsGuard {
  /**
   * Runs `action` unless a pane holds unsaved changes. Then that pane's save
   * bar asks for a save or a reset instead, and nothing is thrown away.
   */
  attempt: (action: () => void) => void;
  /** A pane with unsaved changes holds the dialog; the result lets go. */
  hold: (blocker: Blocker) => () => void;
  /** The foot of the pane column, outside the scroller, where the bar sits. */
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
}

const GuardContext = createContext<SettingsGuard | null>(null);

/**
 * The guard a settings dialog keeps for its panes. Changing pane, closing
 * (the cross, Escape, a press outside) and anything else that would unmount
 * the pane go through `attempt`.
 */
export function useSettingsGuardHost(): SettingsGuard {
  const blocker = useRef<Blocker | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const attempt = useCallback((action: () => void) => {
    if (blocker.current?.()) return;
    action();
  }, []);

  const hold = useCallback((next: Blocker) => {
    blocker.current = next;
    return () => {
      if (blocker.current === next) blocker.current = null;
    };
  }, []);

  return useMemo(() => ({ attempt, hold, slot, setSlot }), [attempt, hold, slot]);
}

export function SettingsGuardProvider({
  guard,
  children,
}: {
  guard: SettingsGuard;
  children: ReactNode;
}) {
  return <GuardContext.Provider value={guard}>{children}</GuardContext.Provider>;
}

/** The surrounding dialog's guard, or null for a pane rendered on its own. */
export function useSettingsGuard(): SettingsGuard | null {
  return useContext(GuardContext);
}

/** The foot of the pane column, where a pane's save bar is rendered. */
export function SettingsSaveSlot() {
  const guard = useSettingsGuard();
  return <div className="sv-save-slot" ref={guard?.setSlot} />;
}
