import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";
import { detectLocale, getLocale, resolveLocale, setLocale, t } from "./index";
import { pl } from "./pl";

afterEach(() => {
  setLocale("en");
  document.cookie = "stellarr_locale=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("resolveLocale", () => {
  it("prefers the cookie over the browser languages", () => {
    expect(resolveLocale("stellarr_locale=pl", ["en-US"])).toBe("pl");
    expect(resolveLocale("stellarr_locale=en", ["pl-PL"])).toBe("en");
  });

  it("finds the cookie among others", () => {
    expect(resolveLocale("theme=dark; stellarr_locale=pl; other=1", ["en"])).toBe("pl");
  });

  it("ignores a cookie that names an unsupported language", () => {
    expect(resolveLocale("stellarr_locale=de", ["pl"])).toBe("pl");
    expect(resolveLocale("stellarr_locale=", ["pl"])).toBe("pl");
  });

  it("takes the first browser language that is Polish or English, whatever its region", () => {
    expect(resolveLocale("", ["de-DE", "pl-PL", "en-US"])).toBe("pl");
    expect(resolveLocale("", ["fr", "en-GB", "pl"])).toBe("en");
    expect(resolveLocale("", ["PL"])).toBe("pl");
  });

  it("falls back to English when nothing matches", () => {
    expect(resolveLocale("", ["de", "fr-CA"])).toBe("en");
    expect(resolveLocale("", [])).toBe("en");
    expect(resolveLocale("other=pl", ["plx"])).toBe("en");
  });
});

describe("detectLocale", () => {
  it("reads the cookie of the document", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    document.cookie = "stellarr_locale=pl; path=/";

    expect(detectLocale()).toBe("pl");
  });

  it("reads the languages of the browser when there is no cookie", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de", "pl"]);

    expect(detectLocale()).toBe("pl");
  });
});

describe("setLocale", () => {
  it("starts in English", () => {
    expect(getLocale()).toBe("en");
    expect(t("nav.users")).toBe("Users");
  });

  it("switches the messages and the lang attribute of the document", () => {
    setLocale("pl");

    expect(getLocale()).toBe("pl");
    expect(document.documentElement.lang).toBe("pl");
    expect(t("nav.users")).toBe("Użytkownicy");

    setLocale("en");

    expect(document.documentElement.lang).toBe("en");
    expect(t("nav.users")).toBe("Users");
  });
});

describe("t", () => {
  it("fills named placeholders, numbers included", () => {
    expect(t("backups.created", { id: "backup-1" })).toBe("Created backup-1.");
    expect(t("logs.shown", { count: 0 })).toBe("0 shown");
  });

  it("leaves a placeholder without a value as it is", () => {
    expect(t("backups.created")).toBe("Created {id}.");
    expect(t("backups.created", { other: 1 })).toBe("Created {id}.");
  });

  it("inserts values literally", () => {
    expect(t("backups.created", { id: "$&{id}" })).toBe("Created $&{id}.");
  });

  it("fills the placeholders of the other language the same way", () => {
    setLocale("pl");

    expect(t("backups.created", { id: "backup-1" })).toBe("Utworzono backup-1.");
  });
});

const placeholders = (message: string) => [...message.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();

describe("the catalogs", () => {
  it("carry exactly the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });

  it("use the same placeholders in every message", () => {
    for (const key of Object.keys(pl) as (keyof typeof pl)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(pl[key]));
    }
  });

  it("have no empty message", () => {
    for (const [key, message] of [...Object.entries(en), ...Object.entries(pl)]) {
      expect(message.trim(), key).not.toBe("");
    }
  });
});
