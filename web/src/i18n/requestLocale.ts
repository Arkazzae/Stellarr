import { cookies } from "next/headers";

import { LOCALE_COOKIE, resolveLocale } from "./defaultLocale";
import type { SupportedLocale } from ".";

/**
 * The language of the request being rendered: the person's remembered choice,
 * then the instance default the operator set in `STELLARR_LANGUAGE`, then
 * English.
 *
 * The variable is read per request on purpose. One published image serves
 * every instance, so nothing about the language may be fixed at build time.
 * Reading the cookie also keeps the pages that call this out of static
 * rendering.
 */
export async function requestLocale(): Promise<SupportedLocale> {
  const remembered = (await cookies()).get(LOCALE_COOKIE)?.value;
  return resolveLocale(remembered, process.env.STELLARR_LANGUAGE);
}
