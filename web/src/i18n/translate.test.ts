import { describe, expect, it } from "vitest";

import { isSupportedLocale, translateMessage } from ".";

describe("translateMessage", () => {
  it("returns a message without placeholders as written, in the requested locale", () => {
    expect(translateMessage("pl", "settings.language.title")).toBe("Język");
    expect(translateMessage("en", "settings.language.title")).toBe("Language");
  });

  it("fills every placeholder and accepts numbers", () => {
    expect(translateMessage("pl", "desktopRelease.meta", { size: 12, date: "dziś" }))
      .toBe("12 · opublikowano dziś");
  });

  it("leaves a placeholder in place when its value is missing", () => {
    expect(translateMessage("en", "desktopRelease.meta", { size: "3 MB" }))
      .toBe("3 MB · published {date}");
    expect(translateMessage("en", "desktopRelease.version")).toBe("Version {version}");
  });

  it("does not interpret placeholder-like text inside a value", () => {
    expect(translateMessage("en", "desktopRelease.meta", { size: "{date}", date: "$&" }))
      .toBe("{date} · published $&");
  });
});

describe("isSupportedLocale", () => {
  it("accepts the shipped locales only", () => {
    expect(isSupportedLocale("pl")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("de")).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});
