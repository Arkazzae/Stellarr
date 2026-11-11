import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";
import { detectLocale, getLocale, resolveLocale, saveLocale, setLocale, t } from "./index";
import { pl } from "./pl";

afterEach(() => {
  setLocale("en");
  document.cookie = "stellarr_locale=; path=/; max-age=0";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveLocale", () => {
  it("takes the language chosen in the panel's settings", () => {
    expect(resolveLocale("pl")).toBe("pl");
    expect(resolveLocale("en")).toBe("en");
  });

  it("starts in English when nothing was chosen or the choice is unknown", () => {
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale("de")).toBe("en");
    expect(resolveLocale("")).toBe("en");
  });
});

describe("detectLocale", () => {
  it("reads the choice kept in this browser", () => {
    saveLocale("pl");

    expect(detectLocale()).toBe("pl");
  });

  it("follows neither the browser's languages nor the web client's cookie", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pl-PL"]);
    document.cookie = "stellarr_locale=pl; path=/";

    expect(detectLocale()).toBe("en");
  });

  it("falls back to English when the browser keeps no storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(detectLocale()).toBe("en");
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
