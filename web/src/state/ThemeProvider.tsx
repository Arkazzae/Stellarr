"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyThemeAttributes,
  normaliseTheme,
  resolveScheme,
  type ResolvedScheme,
  type ThemePreference,
} from "@/design/themes";
import { useMediaQuery } from "@/hooks/useMediaQuery";

interface ThemeContextValue {
  theme: ThemePreference;
  /** What `scheme: "system"` currently resolves to. */
  resolved: ResolvedScheme;
  /** One writer for every axis, so a new axis cannot be forgotten here. */
  update: (patch: Partial<ThemePreference>) => void;
  /** Back to `DEFAULT_THEME`: all axes at once, one storage write. */
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredTheme(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? normaliseTheme(JSON.parse(raw)) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * The preference as external state. `localStorage` is read once, on first use,
 * and the parsed object is kept: `useSyncExternalStore` compares snapshots by
 * identity, and parsing on every read would return a new object each time.
 */
function createThemeStore() {
  const listeners = new Set<() => void>();
  let current: ThemePreference | undefined;

  const read = () => (current ??= readStoredTheme());

  return {
    read,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    write(next: ThemePreference) {
      current = next;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // With storage denied the theme still works for this session; only
        // persistence is lost.
      }
      for (const listener of listeners) listener();
    },
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createThemeStore);
  // The server snapshot is the default the pre-hydration script has already
  // replaced on <html>. Hydration renders it, and the stored preference takes
  // over on the first client commit.
  const theme = useSyncExternalStore(
    store.subscribe,
    store.read,
    () => DEFAULT_THEME,
  );
  const prefersDark = useMediaQuery(DARK_QUERY, true);
  const resolved = resolveScheme(theme.scheme, prefersDark);

  useEffect(() => {
    applyThemeAttributes(document.documentElement, theme, resolved);
  }, [theme, resolved]);

  const update = useCallback(
    (patch: Partial<ThemePreference>) => {
      store.write({ ...store.read(), ...patch });
    },
    [store],
  );
  const reset = useCallback(() => {
    store.write(DEFAULT_THEME);
  }, [store]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, update, reset }),
    [theme, resolved, update, reset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
