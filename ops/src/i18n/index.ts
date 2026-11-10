import { en } from "./en";
import { pl } from "./pl";

export type Locale = "pl" | "en";
export type MessageKey = keyof typeof pl;
export type MessageValues = Record<string, string | number>;

const catalogs: Record<Locale, Record<MessageKey, string>> = { pl, en };
const LOCALE_COOKIE = "stellarr_locale";

function asLocale(value: string | undefined): Locale | null {
  return value === "pl" || value === "en" ? value : null;
}

function localeFromCookie(cookie: string): Locale | null {
  for (const entry of cookie.split(";")) {
    const [name, value] = entry.trim().split("=");
    if (name === LOCALE_COOKIE) return asLocale(value);
  }
  return null;
}

/** The first browser language that is Polish or English, regardless of region. */
function localeFromLanguages(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const locale = asLocale(tag.toLowerCase().split("-")[0]);
    if (locale) return locale;
  }
  return null;
}

/**
 * The language to show: the cookie the web client writes, then the browser's languages,
 * then English.
 */
export function resolveLocale(cookie: string, languages: readonly string[]): Locale {
  return localeFromCookie(cookie) ?? localeFromLanguages(languages) ?? "en";
}

export function detectLocale(): Locale {
  return resolveLocale(document.cookie, navigator.languages);
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
