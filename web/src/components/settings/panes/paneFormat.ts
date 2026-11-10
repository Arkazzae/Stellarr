import type { InterfaceLocale, MessageKey, Translator } from "@/i18n";

const SHORT_DATE: Record<InterfaceLocale, Intl.DateTimeFormat> = {
  pl: shortDateFormat("pl-PL"),
  en: shortDateFormat("en-GB"),
};

function shortDateFormat(tag: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "2-digit", year: "numeric" });
}

/** "6.03.2026" in Polish, "6/03/2026" in English; "" for a date that does not parse. */
export function formatShortDate(iso: string, locale: InterfaceLocale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : SHORT_DATE[locale].format(date);
}

/** The catalogs that hold a `.one`, `.few` and `.many` form of a counted noun. */
type CountedNoun = "settings.member" | "settings.channel" | "settings.permission";

/**
 * "1 osoba", "3 osoby", "5 osób": the catalog form that the locale's plural
 * rules pick for the count. Every category but `one` and `few` reads as `many`,
 * which also covers English, where only `one` and `other` exist.
 */
export function countedNoun(
  t: Translator,
  locale: InterfaceLocale,
  noun: CountedNoun,
  count: number,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const form = category === "one" || category === "few" ? category : "many";
  return t(`${noun}.${form}` satisfies MessageKey, { count });
}
