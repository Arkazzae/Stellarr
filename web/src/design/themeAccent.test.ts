import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, PALETTES, STELLARR_ACCENT, getPalette } from "@/design/themes";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the Stellarr accent", () => {
  it("is what a fresh install and the Midnight and Slate presets start from", () => {
    expect(DEFAULT_THEME.accent).toBe(STELLARR_ACCENT);
    expect(getPalette("midnight").colors.accent).toBe(STELLARR_ACCENT);
    expect(getPalette("slate").colors.accent).toBe(STELLARR_ACCENT);
  });

  it("leaves the other presets on their own accents", () => {
    const others = PALETTES.filter(({ id }) => id !== "midnight" && id !== "slate");

    expect(others.map(({ colors }) => colors.accent)).not.toContain(STELLARR_ACCENT);
  });

  it("is the colour the page shows before the theme script has run", () => {
    const fallback = /:root\s*{[^}]*--palette-accent:\s*(#[\da-f]{6})/i.exec(
      source("src/styles/themes/recipe.css"),
    )?.[1];

    expect(fallback?.toLowerCase()).toBe(STELLARR_ACCENT);
  });

  it("is the colour of the bars in the app icon", () => {
    const bars = /<g fill="(#[\da-f]{6})">/i.exec(source("src/app/icon.svg"))?.[1];

    expect(bars?.toLowerCase()).toBe(STELLARR_ACCENT);
  });
});
