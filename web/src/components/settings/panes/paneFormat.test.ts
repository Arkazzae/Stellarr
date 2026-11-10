import { describe, expect, it } from "vitest";

import { translateMessage, type Translator } from "@/i18n";

import { countedNoun, formatShortDate } from "./paneFormat";

const polish: Translator = (key, values) => translateMessage("pl", key, values);
const english: Translator = (key, values) => translateMessage("en", key, values);

describe("formatShortDate", () => {
  it("writes day, two-digit month and year in the interface locale", () => {
    const iso = new Date(2026, 2, 6, 12).toISOString();

    expect(formatShortDate(iso, "pl")).toBe("6.03.2026");
    expect(formatShortDate(iso, "en")).toBe("6/03/2026");
  });

  it("returns an empty string for a date that does not parse", () => {
    expect(formatShortDate("not a date", "pl")).toBe("");
  });
});

describe("countedNoun", () => {
  it("picks the Polish one, few and many forms", () => {
    expect(countedNoun(polish, "pl", "settings.member", 1)).toBe("1 osoba");
    expect(countedNoun(polish, "pl", "settings.member", 3)).toBe("3 osoby");
    expect(countedNoun(polish, "pl", "settings.member", 5)).toBe("5 osób");
    expect(countedNoun(polish, "pl", "settings.member", 0)).toBe("0 osób");
    expect(countedNoun(polish, "pl", "settings.channel", 22)).toBe("22 kanały");
  });

  it("falls back to the plural for every English count but one", () => {
    expect(countedNoun(english, "en", "settings.permission", 1)).toBe("1 permission");
    expect(countedNoun(english, "en", "settings.permission", 3)).toBe("3 permissions");
    expect(countedNoun(english, "en", "settings.permission", 0)).toBe("0 permissions");
  });
});
