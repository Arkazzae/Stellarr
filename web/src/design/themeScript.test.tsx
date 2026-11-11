import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeScript } from "@/design/themeScript";
import {
  DEFAULT_THEME,
  PALETTES,
  THEME_STORAGE_KEY,
  applyThemeAttributes,
  normaliseTheme,
  resolveScheme,
} from "@/design/themes";

const root = document.documentElement;

function resetRoot() {
  root.removeAttribute("style");
  for (const attribute of [...root.attributes]) {
    if (attribute.name.startsWith("data-")) root.removeAttribute(attribute.name);
  }
}

function snapshot(element: HTMLElement = root) {
  const variables = Object.fromEntries(
    [...element.style].map((name) => [name, element.style.getPropertyValue(name)]),
  );
  return { data: { ...element.dataset }, variables };
}

function runScript() {
  const { container } = render(<ThemeScript />);
  // React never executes a script it inserts, so run the text as a browser
  // would when it meets the inline script in <head>.
  (0, eval)(container.querySelector("script")?.textContent ?? "");
}

function prefersDark(dark: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({ matches: dark && query.includes("dark"), media: query }) as MediaQueryList,
  );
}

/** What the provider would put on <html> for the same stored value. */
function expectedFor(stored: unknown, dark = true) {
  const element = document.createElement("html");
  const theme = normaliseTheme(stored);
  applyThemeAttributes(element, theme, resolveScheme(theme.scheme, dark));
  return snapshot(element);
}

beforeEach(() => {
  localStorage.clear();
  resetRoot();
  prefersDark(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRoot();
});

describe("ThemeScript", () => {
  it("paints the default theme when nothing is stored", () => {
    runScript();

    expect(snapshot()).toEqual(expectedFor(DEFAULT_THEME));
    expect(root.dataset.theme).toBe(DEFAULT_THEME.palette);
  });

  it.each(PALETTES.map(({ id }) => id))(
    "writes what the provider writes for the %s palette",
    (palette) => {
      const stored = { ...DEFAULT_THEME, palette, accent: "#123456" };
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));

      runScript();

      expect(snapshot()).toEqual(expectedFor(stored));
    },
  );

  it("takes the default accent of the palette when the stored one is not a colour", () => {
    const stored = { palette: "harbor", accent: "red;" };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));

    runScript();

    expect(root.style.getPropertyValue("--palette-accent")).toBe("#1a9fff");
    expect(snapshot()).toEqual(expectedFor(stored));
  });

  it("chooses readable text for a light custom accent", () => {
    const stored = { ...DEFAULT_THEME, accent: "#FFEE00" };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));

    runScript();

    expect(root.style.getPropertyValue("--palette-accent")).toBe("#ffee00");
    expect(root.style.getPropertyValue("--palette-on-accent")).toBe("#000000");
  });

  it("migrates ids written by earlier versions", () => {
    const stored = { palette: "github", font: "serif" };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));

    runScript();

    expect(root.dataset.theme).toBe("ink");
    expect(root.dataset.font).toBeUndefined();
    expect(snapshot()).toEqual(expectedFor(stored));
  });

  it.each([true, false])(
    "resolves the system scheme from the OS (dark: %s)",
    (dark) => {
      prefersDark(dark);
      const stored = { ...DEFAULT_THEME, scheme: "system" };
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));

      runScript();

      expect(root.dataset.scheme).toBe(dark ? "dark" : "light");
      expect(snapshot()).toEqual(expectedFor(stored, dark));
    },
  );

  it("replaces unknown values axis by axis", () => {
    const stored = {
      palette: "nope",
      scheme: "sepia",
      contrast: 3,
      size: "xl",
      density: "tight",
      hasOwnProperty: "constructor",
    };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));

    runScript();

    expect(snapshot()).toEqual(expectedFor(stored));
    expect(root.dataset.size).toBe(DEFAULT_THEME.size);
  });

  it.each(["{not json", "null", "42", '"text"'])(
    "falls back to the defaults for stored %s",
    (value) => {
      localStorage.setItem(THEME_STORAGE_KEY, value);

      runScript();

      expect(snapshot()).toEqual(expectedFor(DEFAULT_THEME));
    },
  );

  it("still paints the defaults when storage cannot be read", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    runScript();

    expect(snapshot()).toEqual(expectedFor(DEFAULT_THEME));
  });
});
