import { getLocale, type Locale } from "./index";

// English is formatted day-first with a 24-hour clock, like Polish.
const intlTags: Record<Locale, string> = { pl: "pl-PL", en: "en-GB" };

const intlTag = () => intlTags[getLocale()];

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(intlTag(), options);
}

/** A byte count shown in megabytes, with the unit. */
export function formatMegabytes(bytes: number, maximumFractionDigits: number): string {
  return formatNumber(bytes / 1024 / 1024, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits,
  });
}

/** Date and time down to the second, as the logs and backups show them. */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(intlTag());
}

/** Date and time to the minute, in the abbreviated style of the account tables. */
export function formatShortDateTime(value: string): string {
  return new Date(value).toLocaleString(intlTag(), { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(intlTag());
}

/** Lower-cases text for a case-insensitive search in the active language. */
export function lowerCase(text: string): string {
  return text.toLocaleLowerCase(getLocale());
}
