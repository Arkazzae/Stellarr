import { createContext, useContext } from "react";

import type { Locale } from "@/i18n";

export interface LocaleContextValue {
  locale: Locale;
  /** Switches the panel's language at once and remembers it in this browser. */
  changeLocale: (locale: Locale) => void;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale needs a LocaleProvider.");
  return value;
}
