import { describe, expect, it } from "vitest";

import { documentLocale, FALLBACK_LOCALE, resolveLocale, translateForDocument } from "./defaultLocale";

describe("resolveLocale", () => {
  it("takes the first candidate that names a shipped locale", () => {
    expect(resolveLocale("pl", "en")).toBe("pl");
    expect(resolveLocale("en", "pl")).toBe("en");
  });

  it("skips candidates that are absent or unknown", () => {
    expect(resolveLocale(undefined, "de", "", "pl")).toBe("pl");
    expect(resolveLocale(null, "EN", "en")).toBe("en");
  });

  it("falls back to English when nothing matches", () => {
    expect(FALLBACK_LOCALE).toBe("en");
    expect(resolveLocale()).toBe("en");
    expect(resolveLocale(undefined, "fr")).toBe("en");
  });
});

describe("the page's language", () => {
  it("is what <html lang> says", () => {
    document.documentElement.lang = "en";
    expect(documentLocale()).toBe("en");

    document.documentElement.lang = "pl";
    expect(documentLocale()).toBe("pl");
  });

  it("is English when the page declares nothing it ships", () => {
    document.documentElement.lang = "";
    expect(documentLocale()).toBe("en");

    document.documentElement.lang = "de";
    expect(documentLocale()).toBe("en");
  });

  it("is read at call time, so a translator follows a switch", () => {
    document.documentElement.lang = "pl";
    expect(translateForDocument("settings.language.title")).toBe("Język");

    document.documentElement.lang = "en";
    expect(translateForDocument("settings.language.title")).toBe("Language");
  });

  it("fills placeholders like the provider's translator does", () => {
    document.documentElement.lang = "en";
    expect(translateForDocument("desktopRelease.version", { version: "2.1" })).toBe("Version 2.1");
  });
});
