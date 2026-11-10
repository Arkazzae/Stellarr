import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  FONTS,
  PALETTES,
  normaliseTheme,
  paletteCssVariables,
  readableTextOn,
} from "@/design/themes";
import { parseBlocks } from "@/design/tokenRamp";

const palettesCss = parseBlocks(
  readFileSync(
    join(process.cwd(), "src/styles/themes/palettes.css"),
    "utf8",
  ),
);
const typesetCss = readFileSync(
  join(process.cwd(), "src/styles/themes/typeset.css"),
  "utf8",
);
const fontFacesCss = readFileSync(
  join(process.cwd(), "src/styles/themes/font-faces.css"),
  "utf8",
);
const recipeCss = readFileSync(
  join(process.cwd(), "src/styles/themes/recipe.css"),
  "utf8",
);
const railCss = readFileSync(
  join(process.cwd(), "src/styles/components/rail.css"),
  "utf8",
);
const roomCss = readFileSync(
  join(process.cwd(), "src/styles/components/room.css"),
  "utf8",
);
const rosterCss = readFileSync(
  join(process.cwd(), "src/styles/components/roster.css"),
  "utf8",
);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("theme registry", () => {
  it("offers the requested complete preset set", () => {
    expect(PALETTES.map(({ label }) => label)).toEqual([
      "Midnight",
      "Slate",
      "Evergreen",
      "Harbor",
      "Amethyst",
      "Ink",
    ]);
  });

  it("has one light-ramp CSS block per registered palette", () => {
    const registered = new Set<string>(PALETTES.map(({ id }) => id));
    for (const id of registered) {
      expect(palettesCss.has(`[data-theme="${id}"]`)).toBe(true);
    }
    for (const selector of palettesCss.keys()) {
      const id = /^\[data-theme="([a-z-]+)"\]$/.exec(selector)?.[1];
      if (id !== undefined) expect(registered.has(id)).toBe(true);
    }
  });

  it("contains all 28 requested self-hosted faces", () => {
    expect(FONTS).toHaveLength(28);
    expect(FONTS.map(({ label }) => label)).toEqual([
      "Outfit",
      "Inter",
      "Geist Sans",
      "DM Sans",
      "Plus Jakarta Sans",
      "Manrope",
      "Figtree",
      "IBM Plex Sans",
      "Source Sans 3",
      "Noto Sans",
      "Open Sans",
      "Lato",
      "Poppins",
      "Montserrat",
      "Raleway",
      "Nunito",
      "Rubik",
      "Quicksand",
      "Baloo 2",
      "Varela Round",
      "Comfortaa",
      "Fira Code",
      "JetBrains Mono",
      "Source Code Pro",
      "IBM Plex Mono",
      "Space Grotesk",
      "Sora",
      "Lexend",
    ]);
  });

  it("maps every font id and ships every referenced local asset", () => {
    for (const { id } of FONTS) {
      expect(typesetCss).toContain(`[data-font="${id}"]`);
    }
    const files = [...fontFacesCss.matchAll(/url\(\/(fonts\/[^)]+)\)/g)].map(
      (match) => match[1],
    ).filter(
      (file): file is string => file !== undefined,
    );
    expect(files.length).toBeGreaterThanOrEqual(FONTS.length * 2);
    for (const file of files) {
      expect(existsSync(join(process.cwd(), "public", file))).toBe(true);
    }
  });

  it("keeps structural panels on explicit surface roles", () => {
    expect(recipeCss).toMatch(
      /--surface-room:\s*var\(--palette-background-primary\)/,
    );
    expect(recipeCss).toMatch(
      /--surface-sidebar:\s*var\(--palette-background-secondary\)/,
    );
    expect(railCss).toContain("background:var(--surface-sidebar)");
    expect(railCss).toContain(
      ".channel.active{background:var(--surface-base);color:var(--text)}",
    );
    expect(roomCss).toContain("background:var(--surface-room)");
    expect(rosterCss).toContain("background:var(--surface-sidebar)");
  });
});

describe.each(PALETTES)("$label palette", (palette) => {
  it("publishes every palette role as a CSS variable", () => {
    const variables = paletteCssVariables(palette);
    expect(Object.keys(variables)).toHaveLength(21);
    expect(variables["--palette-background-darkest"]).toBe(
      palette.colors.backgrounds.darkest,
    );
    expect(variables["--palette-background-floating"]).toBe(
      palette.colors.backgrounds.floating,
    );
    expect(variables["--palette-text-faint"]).toBe(palette.colors.text.faint);
    expect(variables["--palette-info"]).toBe(palette.colors.semantic.info);
  });

  it("keeps small interface text readable across its dark surfaces", () => {
    const foregrounds = [
      palette.colors.text.normal,
      palette.colors.text.muted,
      palette.accessibleFaint,
    ];
    const backgrounds = Object.values(palette.colors.backgrounds);
    const failures = foregrounds.flatMap((foreground) =>
      backgrounds
        .filter((background) => contrast(foreground, background) < 4.5)
        .map(
          (background) =>
            `${foreground} on ${background}: ${contrast(foreground, background).toFixed(2)}:1`,
        ),
    );
    expect(failures).toEqual([]);
  });

  it("chooses a legible foreground for its accent fill", () => {
    const foreground = readableTextOn(palette.colors.accent);
    expect(contrast(foreground, palette.colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Evergreen palette", () => {
  it("preserves the supplied full colour vocabulary", () => {
    const evergreen = PALETTES.find(({ id }) => id === "evergreen");
    expect(evergreen?.colors).toEqual({
      accent: "#1db954",
      backgrounds: {
        darkest: "#0a0a0a",
        dark: "#121212",
        primary: "#1a1a1a",
        secondary: "#121212",
        tertiary: "#161616",
        hover: "#282828",
        active: "#333333",
        floating: "#0e0e0e",
      },
      text: { normal: "#e8e8e8", muted: "#a7a7a7", faint: "#6a6a6a" },
      borders: {
        subtle: "rgba(255, 255, 255, 0.06)",
        default: "#282828",
        strong: "rgba(255, 255, 255, 0.18)",
      },
      semantic: {
        success: "#1db954",
        warning: "#f0b232",
        danger: "#e91429",
        info: "#1db954",
      },
    });
  });
});

describe("stored preference migration", () => {
  it("migrates old palette and font ids without discarding other axes", () => {
    expect(
      normaliseTheme({
        palette: "github",
        font: "mono",
        density: "compact",
      }),
    ).toEqual({
      ...DEFAULT_THEME,
      palette: "ink",
      accent: "#58a6ff",
      font: "jetbrains-mono",
      density: "compact",
    });
  });

  it("rejects malformed custom accent values", () => {
    expect(
      normaliseTheme({ ...DEFAULT_THEME, palette: "evergreen", accent: "red;" })
        .accent,
    ).toBe("#1db954");
  });
});
