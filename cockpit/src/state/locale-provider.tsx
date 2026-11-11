import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";

import { getLocale, saveLocale, setLocale, type Locale } from "@/i18n";
import { LocaleContext } from "@/state/locale-context";

/**
 * Holds the panel's language. Messages are looked up as components render, so
 * a change remounts everything below with the new language; the session above
 * stays, and so does the address.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  const changeLocale = useCallback((next: Locale) => {
    setLocale(next);
    saveLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => ({ locale, changeLocale }), [locale, changeLocale]);

  return (
    <LocaleContext.Provider value={value}>
      <Fragment key={locale}>{children}</Fragment>
    </LocaleContext.Provider>
  );
}
