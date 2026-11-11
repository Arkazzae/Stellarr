import { en } from "./en";
import { pl } from "./pl";

export type Locale = "pl" | "en";
export type MessageKey = keyof typeof pl;
export type MessageValues = Record<string, string | number>;

const catalogs: Record<Locale, Record<MessageKey, string>> = { pl, en };
/** Where this browser keeps the panel's language. */
const LOCALE_KEY = "stellarr.cockpit.locale";

export const LOCALES: readonly Locale[] = ["en", "pl"];

function asLocale(value: string | null): Locale | null {
  return value === "pl" || value === "en" ? value : null;
}

/**
 * The panel's language: the one chosen in its settings, else English. The
 * panel does not follow the browser or the web client; the operator picks.
 */
export function resolveLocale(stored: string | null): Locale {
  return asLocale(stored) ?? "en";
}

export function detectLocale(): Locale {
  try {
    return resolveLocale(localStorage.getItem(LOCALE_KEY));
  } catch {
    // Storage can be off (a private window, blocked site data): English it is.
    return "en";
  }
}

/** Remembers the panel's language in this browser. */
export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Without storage the choice holds until the page is closed.
  }
}

let active: Locale = "en";

/** Selects the language of every later lookup and format, and of the document. */
export function setLocale(locale: Locale): void {
  active = locale;
  document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return active;
}

/** Looks a message up in the active language and fills its `{name}` placeholders. */
export function t(key: MessageKey, values: MessageValues = {}): string {
  return catalogs[active][key].replace(/\{([^}]+)\}/g, (token, name: string) => {
    const value = values[name];
    return value === undefined ? token : String(value);
  });
}
