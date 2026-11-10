import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeScript } from "@/design/themeScript";
import {
  DEFAULT_THEME,
  LEGACY_PALETTES,
  PALETTES,
  THEME_STORAGE_KEY,
  getPalette,
  normaliseTheme,
} from "@/design/themes";

/** The ids earlier versions wrote for presets that were later renamed. */
const RENAMED = [
  ["discord", "slate"],
  ["spotify", "evergreen"],
  ["steam", "harbor"],
  ["twitch", "amethyst"],
  ["github-dark", "ink"],
  ["github", "ink"],
] as const;

const root = document.documentElement;

function resetRoot() {
  root.removeAttribute("style");
  for (const attribute of [...root.attributes]) {
    if (attribute.name.startsWith("data-")) root.removeAttribute(attribute.name);
  }
}

/** Runs the pre-hydration script the way a browser runs the inline script. */
function paintFirstFrame() {
  const { container } = render(createElement(ThemeScript));
  (0, eval)(container.querySelector("script")?.textContent ?? "");
}

beforeEach(() => {
  localStorage.clear();
  resetRoot();
});

afterEach(resetRoot);

describe("stored presets under their old ids", () => {
  it.each(RENAMED)("%s resolves to %s", (oldId, newId) => {
    expect(normaliseTheme({ palette: oldId }).palette).toBe(newId);
  });

  it.each(RENAMED)("keeps every other axis stored with %s", (oldId, newId) => {
    const stored = {
      palette: oldId,
      accent: "#123abc",
      scheme: "light",
      contrast: "high",
      font: "lato",
      size: "lg",
      density: "compact",
    };

    expect(normaliseTheme(stored)).toEqual({ ...stored, palette: newId });
  });

  it.each(RENAMED)(
    "gives %s the accent of the renamed preset when none was chosen",
    (oldId, newId) => {
      expect(normaliseTheme({ palette: oldId }).accent).toBe(
        getPalette(newId).colors.accent,
      );
    },
  );

  it("does not let an old id shadow a preset that exists today", () => {
    const current = new Set<string>(PALETTES.map(({ id }) => id));

    expect(Object.keys(LEGACY_PALETTES).filter((id) => current.has(id))).toEqual([]);
  });
});

describe("the first paint", () => {
  it.each(RENAMED)("shows %s as %s before hydration", (oldId, newId) => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ palette: oldId }));

    paintFirstFrame();

    expect(root.dataset.theme).toBe(newId);
    expect(root.style.getPropertyValue("--palette-accent")).toBe(
      getPalette(newId).colors.accent,
    );
  });

  it("agrees with normaliseTheme for every id in the legacy table", () => {
    for (const oldId of Object.keys(LEGACY_PALETTES)) {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ palette: oldId }));
      resetRoot();

      paintFirstFrame();

      expect(root.dataset.theme, oldId).toBe(normaliseTheme({ palette: oldId }).palette);
    }
  });

  it("keeps the other stored axes when the id is an old one", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ palette: "twitch", accent: "#123abc", font: "lato" }),
    );

    paintFirstFrame();

    expect(root.dataset.theme).toBe("amethyst");
    expect(root.dataset.font).toBe("lato");
    expect(root.style.getPropertyValue("--palette-accent")).toBe("#123abc");
    expect(root.dataset.density).toBe(DEFAULT_THEME.density);
  });
});
