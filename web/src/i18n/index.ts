import { en } from "./messages/en";
import { pl } from "./messages/pl";

export const SUPPORTED_LOCALES = ["pl", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type InterfaceLocale = SupportedLocale;
export type TranslationTargetLanguage = "pl" | "en";

export interface LanguageSettings {
  locale: InterfaceLocale;
  chatTranslationEnabled: boolean;
  chatAutoTranslateEnabled: boolean;
  chatTranslationTargetLanguage: TranslationTargetLanguage;
}

/** Everything but the locale, which comes from the request and not from a default. */
export const TRANSLATION_DEFAULTS = {
  chatTranslationEnabled: false,
  chatAutoTranslateEnabled: false,
  chatTranslationTargetLanguage: "en",
} as const satisfies Omit<LanguageSettings, "locale">;

/** Polish is the source catalog; the English one is checked against it by tests. */
export type MessageKey = keyof typeof pl;
export type MessageValues = Record<string, string | number>;
export type Translator = (key: MessageKey, values?: MessageValues) => string;

const catalogs: Record<SupportedLocale, Record<MessageKey, string>> = { pl, en };

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

/**
 * Looks a message up and fills its `{name}` placeholders. A placeholder with
 * no matching value stays as written, so a missing argument is visible in the
 * UI instead of rendering as "undefined".
 */
export function translateMessage(
  locale: SupportedLocale,
  key: MessageKey,
  values: MessageValues = {},
): string {
  return catalogs[locale][key].replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
