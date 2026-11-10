import { beforeEach } from "vitest";

import { setLocale } from "@/i18n";

/** Runs the tests of the calling file in Polish, the language their assertions are written in. */
export function selectPolish(): void {
  beforeEach(() => setLocale("pl"));
}
